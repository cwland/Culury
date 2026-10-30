import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { jobs, recipes } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { jobView } from "../lib/importJobs.js";
import { userOf } from "./recipes.js";

export default async function importRoutes(app: FastifyInstance) {
  const { db, jobs: queue, photos } = app;

  // Import a recipe from a link, or from pasted text. Runs in the background: the answer is the
  // job (check GET /api/imports/:id). "wait": up to that many seconds for it to finish first,
  // handy for iOS Shortcuts and scripts. "force": import even if this page is already saved.
  app.post("/api/recipes/import", async (req, reply) => {
    const body = z
      .object({
        url: z.string().trim().max(2000).optional(),
        text: z.string().trim().max(50000).optional(),
        force: z.boolean().optional(),
        wait: z.number().int().min(0).max(60).optional(),
      })
      .strict()
      .refine((b) => !!b.url !== !!b.text, "Send a link (url) or pasted text (text)")
      .parse(req.body);
    if (body.url && !/^https?:\/\/\S+$/i.test(body.url)) throw new HttpError(400, "That doesn't look like a web address (it should start with https://)");
    if (body.text && body.text.length < 20) throw new HttpError(400, "Paste the whole recipe (title, ingredients and steps)");
    const job = body.url
      ? await queue.enqueue("import-url", { url: body.url, force: !!body.force }, userOf(req))
      : await queue.enqueue("import-text", { text: body.text! }, userOf(req));
    const done = body.wait ? await queue.wait(job.id, body.wait * 1000) : job;
    const finished = done && (done.status === "done" || done.status === "failed");
    return reply.status(finished ? 200 : 202).send(jobView(done ?? job));
  });

  app.get("/api/imports/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const job = await queue.get(id);
    if (!job || !job.kind.startsWith("import-")) throw notFound("Import");
    return jobView(job);
  });

  // Recent imports, newest first
  app.get("/api/imports", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return (await db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit)).filter((j) => j.kind.startsWith("import-")).map(jobView);
  });

  // Try a failed import again (or import a duplicate after all, with force)
  app.post("/api/imports/:id/retry", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { force } = z.object({ force: z.boolean().optional() }).strict().parse(req.body ?? {});
    const job = await queue.get(id);
    if (!job || !job.kind.startsWith("import-")) throw notFound("Import");
    const again = await queue.enqueue(job.kind, { ...job.payload, ...(force ? { force: true } : {}) }, userOf(req));
    return reply.status(202).send(jobView(again));
  });

  // ---------- photos ----------

  // Served without signing in (pictures can't send a login); the names are random
  app.get("/api/photos/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const file = photos.path(name);
    if (!file || !fs.existsSync(file)) throw notFound("Photo");
    return reply.type("image/webp").header("Cache-Control", "public, max-age=31536000, immutable").send(fs.createReadStream(file));
  });

  const readUpload = async (req: FastifyRequest) => {
    const file = await req.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) throw new HttpError(400, "Choose a photo to upload");
    const buf = await file.toBuffer().catch(() => {
      throw new HttpError(413, "That photo is too large (25 MB at most)");
    });
    return photos.save(buf);
  };

  // A photo for a recipe you haven't saved yet: returns its address to put in imageUrl
  app.post("/api/photos", async (req, reply) => reply.status(201).send({ imageUrl: await readUpload(req) }));

  // Replace a recipe's photo (the old one is deleted if it was uploaded here)
  app.post("/api/recipes/:id/photo", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [r] = await db.select({ imageUrl: recipes.imageUrl }).from(recipes).where(eq(recipes.id, id));
    if (!r) throw notFound("Recipe");
    const imageUrl = await readUpload(req);
    await db.update(recipes).set({ imageUrl, updatedAt: new Date() }).where(eq(recipes.id, id));
    await photos.remove(r.imageUrl);
    return reply.status(201).send({ imageUrl });
  });
}
