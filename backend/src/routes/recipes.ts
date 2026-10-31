import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { recipeSnapshots, recipeUser, recipes, substitutions } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { createRecipe, listQuery, listRecipes, loadRecipe, saveRecipe, updateRecipe } from "../lib/recipes.js";
import { ingredientsChanged, ingredientsUpdated, recipeAdded } from "../lib/nutrition.js";
import { changedParts, describeParts, ensureVersions, firstVersion, newVersion, syncActive, versionData } from "../lib/versions.js";

// Who's asking: a signed-in person, or null for an API key (keys belong to the household, not a person)
export const userOf = (req: FastifyRequest) => (req.auth?.method === "token" ? req.auth.userId : null);
function requireUser(req: FastifyRequest) {
  const id = userOf(req);
  if (!id) throw new HttpError(403, "Sign in to do this (favorites, ratings and notes are per person)");
  return id;
}

const editVersion = z.object({ version: z.enum(["new", "current"]).optional() }).passthrough();

export default async function recipeRoutes(app: FastifyInstance) {
  const { db } = app;

  // The recipe box: search, filter by tag / category / collection / favorites, sort
  app.get("/api/recipes", async (req) => listRecipes(db, userOf(req), listQuery.parse(req.query)));

  app.get("/api/recipes/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    return loadRecipe(db, id, userOf(req));
  });

  // Add a recipe. Ingredients and steps can be one block of text (a line each) or lists.
  app.post("/api/recipes", async (req, reply) => {
    const body = createRecipe.parse(req.body);
    const id = await saveRecipe(db, null, body, userOf(req));
    await firstVersion(db, id, "created", userOf(req));
    await recipeAdded(app, id, { offered: userOf(req) !== null }); // (an API key never sees the AI check offer)
    return reply.status(201).send(await loadRecipe(db, id, userOf(req)));
  });

  // Change any of its fields (tags, categories and collections, when given, replace the old ones)
  app.patch("/api/recipes/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    // version: "new" saves the change as a new version; "current" (or left out) changes the active one
    const { version = "current", ...fields } = editVersion.parse(req.body ?? {});
    const body = updateRecipe.parse(fields);
    const [before] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before) await ensureVersions(db, id);
    await saveRecipe(db, id, body, userOf(req));
    const [after] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before && after) {
      const parts = changedParts(versionData(before), versionData(after));
      // (nutrition alone never makes a version; tags, categories and the photo aren't in versions)
      if (version === "new" && parts.some((p) => p !== "nutrition")) await newVersion(db, id, "edit", `Changed ${describeParts(parts)}`, userOf(req));
      else await syncActive(db, id);
      if (ingredientsChanged(before.ingredients, after.ingredients)) await ingredientsUpdated(app, id);
    }
    await db.delete(recipeSnapshots).where(eq(recipeSnapshots.recipeId, id)); // edited by hand: "Undo AI changes" would wipe the edit
    // A new photo (or none): the old one goes, if it was uploaded here and nothing else uses it
    if (body.imageUrl !== undefined && before?.imageUrl && body.imageUrl !== before.imageUrl) {
      const [other] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.imageUrl, before.imageUrl));
      if (!other) await app.photos.remove(before.imageUrl);
    }
    return loadRecipe(db, id, userOf(req));
  });

  app.delete("/api/recipes/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(recipes).where(eq(recipes.id, id)).returning({ id: recipes.id, imageUrl: recipes.imageUrl });
    if (!gone.length) throw notFound("Recipe");
    await app.photos.remove(gone[0].imageUrl); // (only photos uploaded here)
    return reply.status(204).send();
  });

  // A copy to change without touching the original ("Mom's chili (copy)")
  app.post("/api/recipes/:id/duplicate", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await loadRecipe(db, id, null);
    const copy = await saveRecipe(
      db,
      null,
      {
        title: `${r.title} (copy)`,
        description: r.description,
        ingredients: r.ingredients.map((i) => i.raw),
        steps: r.steps.map((s) => (s.section ? { section: s.section } : { text: s.text })),
        servings: r.servings,
        yieldText: r.yieldText,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        totalMinutes: r.totalMinutes,
        sourceUrl: r.sourceUrl,
        sourceName: r.sourceName,
        imageUrl: r.imageUrl,
        notes: r.notes,
        tags: r.tags,
        categories: r.categories.map((c) => c.id),
      },
      userOf(req)
    );
    return reply.status(201).send(await loadRecipe(db, copy, userOf(req)));
  });

  // ---------- your own: favorite, pinned, rating, private notes ----------
  app.put("/api/recipes/:id/me", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        favorite: z.boolean().optional(),
        pinned: z.boolean().optional(),
        rating: z.number().int().min(1).max(5).nullable().optional(),
        notes: z.string().trim().max(20000).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
      })
      .strict()
      .parse(req.body);
    const [exists] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
    if (!exists) throw notFound("Recipe");
    const set = { ...body, updatedAt: new Date() };
    await db.insert(recipeUser).values({ recipeId: id, userId, ...body }).onConflictDoUpdate({ target: [recipeUser.recipeId, recipeUser.userId], set });
    const [me] = await db.select().from(recipeUser).where(and(eq(recipeUser.recipeId, id), eq(recipeUser.userId, userId)));
    return { favorite: me.favorite, pinned: me.pinned, rating: me.rating, notes: me.notes };
  });

  // ---------- substitution history ----------
  app.post("/api/recipes/:id/substitutions", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        original: z.string().trim().min(1, "What did you replace?").max(200),
        replacement: z.string().trim().min(1, "What did you use instead?").max(200),
        note: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
      })
      .strict()
      .parse(req.body);
    const [exists] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
    if (!exists) throw notFound("Recipe");
    const [row] = await db
      .insert(substitutions)
      .values({ recipeId: id, userId: userOf(req), ...body })
      .returning({ id: substitutions.id, original: substitutions.original, replacement: substitutions.replacement, note: substitutions.note, createdAt: substitutions.createdAt });
    return reply.status(201).send(row);
  });

  app.delete("/api/substitutions/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(substitutions).where(eq(substitutions.id, id)).returning({ id: substitutions.id });
    if (!gone.length) throw notFound("Substitution");
    return reply.status(204).send();
  });
}
