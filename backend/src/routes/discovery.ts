import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { discoveryFeeds, discoveryItems, users } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { newFeedRow, readFeedAt, refreshAllFeeds, refreshFeed, storeItems } from "../lib/discovery.js";
import { matchTags } from "../lib/rss.js";
import { jobView } from "../lib/importJobs.js";

// Discovery: the household's RSS / Atom feeds and their posts, and each person's filter tags.
// Everything here is plain code: no AI. (Importing a post into your recipes is the normal import.)

const webUrl = z
  .string()
  .trim()
  .max(2000)
  .url("That isn't a web address")
  .refine((u) => /^https?:\/\//i.test(u), "Only http:// and https:// addresses");

const userOf = (req: FastifyRequest) => (req.auth?.method === "token" ? req.auth.userId : null);
const sortKey = sql`coalesce(${discoveryItems.pubDate}, ${discoveryItems.firstSeenAt})`;
// In your recipes: the recipe this post became, or one saved from the same link (written out in
// full: inside a subquery a bare column name would mean the subquery's own table)
const recipeOf = sql<number | null>`coalesce("discovery_items"."recipe_id", (select r.id from recipes r where r.source_url = "discovery_items"."link" order by r.id limit 1))`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function tagsOf(app: FastifyInstance, userId: number | null) {
  if (!userId) return [];
  const [u] = await app.db.select({ tags: users.discoveryTags }).from(users).where(eq(users.id, userId));
  return u?.tags ?? [];
}

export default async function discoveryRoutes(app: FastifyInstance) {
  const { db } = app;
  const feedList = () =>
    db
      .select({ id: discoveryFeeds.id, url: discoveryFeeds.url, title: discoveryFeeds.title, siteUrl: discoveryFeeds.siteUrl, iconUrl: discoveryFeeds.iconUrl, lastFetchedAt: discoveryFeeds.lastFetchedAt, lastError: discoveryFeeds.lastError, createdAt: discoveryFeeds.createdAt, items: count(discoveryItems.id) })
      .from(discoveryFeeds)
      .leftJoin(discoveryItems, eq(discoveryItems.feedId, discoveryFeeds.id))
      .groupBy(discoveryFeeds.id)
      .orderBy(sql`lower(${discoveryFeeds.title})`);

  // ---------- feeds ----------

  app.get("/api/discovery/feeds", async () => feedList());

  // Subscribe: read it straight away (a website's address: the feed it names)
  app.post("/api/discovery/feeds", async (req, reply) => {
    const { url } = z.object({ url: webUrl }).parse(req.body);
    const taken = async (u: string) => (await db.select({ id: discoveryFeeds.id }).from(discoveryFeeds).where(eq(discoveryFeeds.url, u))).length > 0;
    if (await taken(url)) throw new HttpError(409, "You're already subscribed to that feed");
    let read;
    try {
      read = await readFeedAt(url, app.fetchOptions);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    if (read.url !== url && (await taken(read.url))) throw new HttpError(409, "You're already subscribed to that feed");
    const [row] = await db.insert(discoveryFeeds).values(newFeedRow(read.url, read.feed, userOf(req))).returning({ id: discoveryFeeds.id });
    await storeItems(db, row.id, read.feed);
    const feed = (await feedList()).find((f) => f.id === row.id);
    return reply.status(201).send(feed);
  });

  app.delete("/api/discovery/feeds/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(discoveryFeeds).where(eq(discoveryFeeds.id, id)).returning({ id: discoveryFeeds.id });
    if (!row) throw notFound("Feed");
    return reply.status(204).send();
  });

  // Check now: every feed, or ?feed=
  app.post("/api/discovery/refresh", async (req) => {
    const { feed } = z.object({ feed: z.coerce.number().int().positive().optional() }).parse(req.query);
    if (!feed) return refreshAllFeeds(db, app.fetchOptions);
    const r = await refreshFeed(db, feed, app.fetchOptions);
    return { feeds: 1, added: r.added, failed: r.error ? 1 : 0 };
  });

  // ---------- posts ----------

  // Newest first; ?feed= one feed; ?match=tags only posts matching one of your tags; ?before= the
  // next page (from "next")
  app.get("/api/discovery/items", async (req) => {
    const q = z
      .object({
        feed: z.coerce.number().int().positive().optional(),
        match: z.enum(["all", "tags"]).default("all"),
        limit: z.coerce.number().int().min(1).max(100).default(48),
        before: z
          .string()
          .regex(/^\d+_\d+$/)
          .optional(),
      })
      .parse(req.query);
    const tags = (await tagsOf(app, userOf(req))).map((t) => t.trim()).filter(Boolean);
    const where: SQL[] = [];
    if (q.feed) where.push(eq(discoveryItems.feedId, q.feed));
    if (q.before) {
      const [ms, id] = q.before.split("_").map(Number);
      where.push(sql`(${sortKey}, ${discoveryItems.id}) < (${new Date(ms).toISOString()}::timestamptz, ${id})`);
    }
    if (q.match === "tags") {
      if (!tags.length) return { items: [], more: false, next: null, tags };
      // the same as matchTags: title, categories and summary, any case, part of a word
      const hay = sql`lower(${discoveryItems.title} || ' ' || ${discoveryItems.categories}::text || ' ' || coalesce(${discoveryItems.description}, ''))`;
      where.push(or(...tags.map((t) => sql`strpos(${hay}, ${t.toLowerCase()}) > 0`))!);
    }
    const rows = await db
      .select({ id: discoveryItems.id, feedId: discoveryItems.feedId, feedTitle: discoveryFeeds.title, feedIcon: discoveryFeeds.iconUrl, title: discoveryItems.title, link: discoveryItems.link, pubDate: discoveryItems.pubDate, author: discoveryItems.author, categories: discoveryItems.categories, description: discoveryItems.description, thumbnailUrl: discoveryItems.thumbnailUrl, recipeId: recipeOf, sort: sql<string>`(extract(epoch from ${sortKey}) * 1000)::bigint` })
      .from(discoveryItems)
      .innerJoin(discoveryFeeds, eq(discoveryFeeds.id, discoveryItems.feedId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(sortKey), desc(discoveryItems.id))
      .limit(q.limit + 1);
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ sort: _s, ...r }) => ({ ...r, matchedTags: matchTags(r, tags) })),
      more,
      next: more && last ? `${last.sort}_${last.id}` : null,
      tags,
    };
  });

  app.get("/api/discovery/items/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [r] = await db
      .select({ id: discoveryItems.id, feedId: discoveryItems.feedId, feedTitle: discoveryFeeds.title, feedIcon: discoveryFeeds.iconUrl, feedSite: discoveryFeeds.siteUrl, title: discoveryItems.title, link: discoveryItems.link, pubDate: discoveryItems.pubDate, author: discoveryItems.author, categories: discoveryItems.categories, description: discoveryItems.description, contentHtml: discoveryItems.contentHtml, thumbnailUrl: discoveryItems.thumbnailUrl, recipeId: recipeOf })
      .from(discoveryItems)
      .innerJoin(discoveryFeeds, eq(discoveryFeeds.id, discoveryItems.feedId))
      .where(eq(discoveryItems.id, id));
    if (!r) throw notFound("Post");
    return { ...r, matchedTags: matchTags(r, await tagsOf(app, userOf(req))) };
  });

  // Import Recipe: the normal import of the post's link; if the site keeps Culury out (or the page
  // has no recipe), the feed's copy of the post is read instead. The post then shows In your recipes.
  app.post("/api/discovery/items/:id/import", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [p] = await db.select().from(discoveryItems).where(eq(discoveryItems.id, id));
    if (!p) throw notFound("Post");
    if (!p.link) throw new HttpError(400, "This post has no link to a recipe page to import");
    const body = p.contentHtml ?? (p.description ? `<p>${esc(p.description)}</p>` : "");
    const feedCopy = `<!DOCTYPE html><html><head><title>${esc(p.title)}</title></head><body><h1>${esc(p.title)}</h1>${body}</body></html>`;
    const job = await app.jobs.enqueue("import-url", { url: p.link, feedCopy, discoveryItemId: p.id }, userOf(req));
    return reply.status(202).send(jobView(job));
  });

  // ---------- your tags ----------

  app.get("/api/discovery/tags", async (req) => ({ tags: await tagsOf(app, userOf(req)) }));

  app.put("/api/discovery/tags", async (req) => {
    const userId = userOf(req);
    if (!userId) throw new HttpError(403, "Sign in to keep your own tags");
    const { tags } = z.object({ tags: z.array(z.string().max(40, "A tag is 40 characters at most")).max(50, "50 tags at most") }).parse(req.body);
    const seen = new Set<string>();
    const kept = tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
    await db.update(users).set({ discoveryTags: kept }).where(eq(users.id, userId));
    return { tags: kept };
  });

}
