import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { groceryItems, groceryLists, users } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { loadRecipe } from "../lib/recipes.js";
import { fileName, groceryEmail, recipeEmail, recipeJsonLd, recipePrintPage } from "../lib/share.js";
import { isoDay, planEmail } from "../lib/reminders.js";
import { userOf } from "./recipes.js";

// Sharing: a recipe by email, as a printable page (save as PDF), or as schema.org JSON-LD; the
// grocery list by email; and each person's daily meal plan email.
export default async function shareRoutes(app: FastifyInstance) {
  const { db, mail } = app;

  const me = async (req: FastifyRequest) => {
    const id = userOf(req);
    const [u] = id ? await db.select().from(users).where(eq(users.id, id)) : [];
    return u ?? null;
  };
  // Emails go out in someone's name: only from a signed-in person, not an API key
  const signedIn = (req: FastifyRequest) => {
    if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to send email (API keys can't)");
  };
  const mailOrStop = async () => {
    const a = await mail.active();
    if (!a) throw new HttpError(409, "Email isn't set up yet. The owner can set it up in Settings › Email.");
    return a.config;
  };
  const recipients = z
    .string()
    .trim()
    .min(1, "Who should get it?")
    .max(1000)
    .transform((s) => s.split(/[,;\s]+/).filter(Boolean))
    .pipe(z.array(z.string().email("That doesn't look like an email address")).min(1).max(10, "Up to 10 people at a time"));

  // ---------- a recipe ----------
  app.get("/api/recipes/:id/jsonld", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await loadRecipe(db, id, null);
    const appUrl = (await mail.active())?.config.appUrl ?? null;
    return reply
      .type("application/ld+json")
      .header("Content-Disposition", `attachment; filename="${fileName(r.title)}.json"`)
      .send(JSON.stringify(recipeJsonLd(r, appUrl), null, 2));
  });

  app.get("/api/recipes/:id/print", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return reply.type("text/html; charset=utf-8").send(recipePrintPage(await loadRecipe(db, id, null)));
  });

  app.post("/api/recipes/:id/email", async (req) => {
    const { id } = idParam.parse(req.params);
    signedIn(req);
    const body = z.object({ to: recipients, note: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const config = await mailOrStop();
    const r = await loadRecipe(db, id, null);
    const u = await me(req);
    const msg = recipeEmail(r, { appUrl: config.appUrl ?? null, from: u?.displayName || u?.username || "Someone", note: body.note });
    for (const to of body.to) await mail.send({ to, ...msg }, config, "recipe");
    return { sent: body.to.length };
  });

  // ---------- the grocery list ----------
  app.post("/api/grocery/lists/:id/email", async (req) => {
    const { id } = idParam.parse(req.params);
    signedIn(req);
    const body = z.object({ to: recipients.optional() }).strict().parse(req.body ?? {});
    const config = await mailOrStop();
    const [list] = await db.select().from(groceryLists).where(eq(groceryLists.id, id));
    if (!list) throw notFound("List");
    const u = await me(req);
    const to = body.to ?? (u?.email ? [u.email] : null);
    if (!to) throw new HttpError(400, "Add your email address in Settings › Profile, or say who should get it");
    const items = await db.select().from(groceryItems).where(eq(groceryItems.listId, id)).orderBy(asc(groceryItems.position));
    if (!items.some((i) => !i.checked)) throw new HttpError(400, "There's nothing left to get on this list");
    const msg = groceryEmail(list.name, items, u?.displayName || u?.username || "Someone");
    for (const addr of to) await mail.send({ to: addr, ...msg }, config, "grocery-list");
    return { sent: to.length };
  });

  // ---------- the daily meal plan email ----------
  app.put("/api/profile/reminder", async (req) => {
    const id = userOf(req);
    if (!id || req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
    const { remindAt } = z.object({ remindAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time like 17:30").nullable() }).strict().parse(req.body);
    const u = await me(req);
    if (remindAt && !u?.email) throw new HttpError(400, "Add your email address first");
    // turned on after today's time has passed: starts tomorrow
    const now = app.now();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    await db.update(users).set({ remindAt, ...(remindAt && remindAt <= hhmm ? { remindedOn: isoDay(now) } : {}) }).where(eq(users.id, id));
    return { remindAt };
  });

  // Send it now (to check how it looks)
  app.post("/api/profile/reminder/test", async (req) => {
    const u = await me(req);
    if (!u || req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
    if (!u.email) throw new HttpError(400, "Add your email address first");
    const config = await mailOrStop();
    const msg = await planEmail(db, isoDay(app.now()), config.appUrl ?? null);
    if (!msg) throw new HttpError(400, "Nothing is planned for today or tomorrow, so there's nothing to send");
    await mail.send({ to: u.email, ...msg }, config, "reminder");
    return { sent: 1 };
  });
}
