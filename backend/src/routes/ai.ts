import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { recipes } from "../db/schema.js";
import { AiError } from "../lib/ai.js";
import { estimateNutrition, mealIdeas } from "../lib/aiHelpers.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { nutritionInput } from "../lib/recipes.js";
import { jobView } from "../lib/importJobs.js";
import { applyEnhancements, applyInput, requireEnhance, suggestEnhancements, undoEnhancements } from "../lib/enhance.js";
import { loadRecipe } from "../lib/recipes.js";
import { userOf } from "./recipes.js";
import { afterAiCheck, nutritionWanted } from "../lib/nutrition.js";
import { changedParts, describeParts, ensureVersions, newVersion, syncActive, versionData } from "../lib/versions.js";

// AI for everyone in the household (the settings themselves are the owner's, under /api/settings/ai)
export default async function aiRoutes(app: FastifyInstance) {
  const { db, ai, photos, jobs: queue } = app;
  const asHttp = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(e.message.includes("Settings › AI") ? 409 : 502, e.message);
      throw e;
    }
  };

  // Is AI there, and can it read photos? (the app shows AI buttons only when it is)
  app.get("/api/ai/status", async () => ai.status());

  // ---------- nutrition ----------
  const recipeOf = async (id: number) => {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!r) throw notFound("Recipe");
    return r;
  };
  // Estimate with AI (replaces what's there)
  app.post("/api/recipes/:id/nutrition", async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await recipeOf(id);
    const nutrition = await asHttp(() => estimateNutrition(ai, r));
    await db.update(recipes).set({ nutrition }).where(eq(recipes.id, id));
    await syncActive(db, id); // nutrition goes into the active version
    return nutrition;
  });
  // Type it in (from the package or another app), or clear it with null
  app.put("/api/recipes/:id/nutrition", async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await recipeOf(id);
    const nutrition = req.body === null ? null : nutritionInput.parse(req.body);
    await db.update(recipes).set({ nutrition: nutrition && { ...nutrition, servings: nutrition.servings ?? r.servings } }).where(eq(recipes.id, id));
    await syncActive(db, id);
    return nutrition;
  });

  // ---------- AI Enhance ----------
  // What the AI would change (saves nothing; the wizard applies the sections you keep)
  // With "Accept: application/x-ndjson" it sends progress as it goes, one JSON object per line:
  // {"type":"step","text":"Asking Home AI (qwen3-vl:32b)…","waiting":true} … then
  // {"type":"result","enhancement":{…}} or {"type":"error","status":502,"error":"…"}
  app.post("/api/recipes/:id/enhance", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    // ?skip=<service id>,…: leave out services the person skipped as too slow
    const skip = String((req.query as { skip?: string }).skip ?? "").split(",").filter(Boolean);
    if (!String(req.headers.accept ?? "").includes("application/x-ndjson")) return asHttp(() => suggestEnhancements(db, ai, id, undefined, { skip }));
    reply.hijack();
    const out = reply.raw;
    // The window was closed or the service skipped: stop asking (the AI server stops generating too)
    const stop = new AbortController();
    out.on("close", () => !out.writableFinished && stop.abort());
    out.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" });
    const send = (o: object) => !out.destroyed && out.write(JSON.stringify(o) + "\n");
    try {
      const enhancement = await asHttp(() => suggestEnhancements(db, ai, id, (s) => send(s.status ? { type: "status", text: s.text } : { type: "step", ...s }), { skip, signal: stop.signal }));
      send({ type: "result", enhancement });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500 && !(e instanceof HttpError)) req.log.error(e);
      send({ type: "error", status, error: status === 500 && !(e instanceof HttpError) ? "Something went wrong. Try again." : (e as Error).message });
    }
    out.end();
  });
  // Save the sections kept in the wizard (the recipe as it was is kept for undo)
  app.post("/api/recipes/:id/enhance/apply", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = applyInput.parse(req.body ?? {});
    await requireEnhance(db, ai);
    const [before] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before) await ensureVersions(db, id);
    await applyEnhancements(db, id, body, userOf(req));
    const [after] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before && after) {
      // New steps or ingredients: a new version. Only nutrition, categories or tags: the active one.
      const parts = changedParts(versionData(before), versionData(after));
      if (parts.includes("steps") || parts.includes("ingredients")) await newVersion(db, id, "ai", `AI check: changed ${describeParts(parts)}`, userOf(req));
      else await syncActive(db, id);
      await afterAiCheck(app, id, before.ingredients, body.nutrition !== undefined);
    }
    return loadRecipe(db, id, userOf(req));
  });
  // "Not now" on the AI check offer: nutrition it would have estimated is worked out now (Auto nutrition)
  app.post("/api/recipes/:id/enhance/skip", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [r] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
    if (!r) throw notFound("Recipe");
    await nutritionWanted(app, id);
    return reply.status(204).send();
  });
  // Undo works even if AI has been switched off since: it only puts the recipe back
  app.post("/api/recipes/:id/enhance/undo", async (req) => {
    const { id } = idParam.parse(req.params);
    const [before] = await db.select({ ingredients: recipes.ingredients, nutrition: recipes.nutrition }).from(recipes).where(eq(recipes.id, id));
    await undoEnhancements(db, id);
    await syncActive(db, id);
    const [after] = await db.select({ nutrition: recipes.nutrition }).from(recipes).where(eq(recipes.id, id));
    if (before && after) await afterAiCheck(app, id, before.ingredients, JSON.stringify(before.nutrition) !== JSON.stringify(after.nutrition));
    return loadRecipe(db, id, userOf(req));
  });

  // ---------- meal ideas ----------
  app.post("/api/ai/ideas", async (req) => {
    const { ask } = z.object({ ask: z.string().trim().max(300).optional() }).strict().parse(req.body ?? {});
    const d = app.now();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { ideas: await asHttp(() => mealIdeas(db, ai, { ask, today })) };
  });

  // ---------- a collection from another app ----------
  // One file (a Paprika export…), read in the background; GET /api/imports/:id has the summary
  app.post("/api/recipes/import/file", async (req, reply) => {
    const part = await req.file({ limits: { fileSize: 1024 * 1024 * 1024 } });
    if (!part) throw new HttpError(400, "Choose a recipe file to import");
    const buf = await part.toBuffer().catch(() => {
      throw new HttpError(413, "That file is too large (1 GB at most)");
    });
    const name = (part.filename || "recipes").slice(0, 200);
    const file = await photos.saveIncomingFile(buf);
    const job = await queue.enqueue("import-file", { file, name }, userOf(req));
    return reply.status(202).send(jobView(job));
  });

  // ---------- recipes from photos ----------
  // Up to 4 photos of one recipe (a card front and back, two cookbook pages), read in the background
  app.post("/api/recipes/import/photos", async (req, reply) => {
    if (!(await ai.active("photo"))) throw new HttpError(409, "Reading photos needs an AI service that can see pictures. Turn on AI in Settings › AI, and tick “Can read photos” on a service.");
    const files: string[] = [];
    try {
      for await (const part of req.files({ limits: { files: 4, fileSize: 25 * 1024 * 1024 } })) {
        const buf = await part.toBuffer().catch(() => {
          throw new HttpError(413, "That photo is too large (25 MB at most)");
        });
        files.push(await photos.saveIncoming(buf));
      }
    } catch (e) {
      await photos.removeIncoming(files);
      if ((e as { code?: string }).code === "FST_FILES_LIMIT") throw new HttpError(400, "Up to 4 photos of one recipe at a time");
      throw e;
    }
    if (!files.length) throw new HttpError(400, "Choose a photo of the recipe");
    const job = await queue.enqueue("import-photo", { files }, userOf(req));
    return reply.status(202).send(jobView(job));
  });
}
