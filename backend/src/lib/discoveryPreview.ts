import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { discoveryItems, type RecipePreview } from "../db/schema.js";
import { AiError, type AiService } from "./ai.js";
import { estimateNutrition } from "./aiHelpers.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { pageInfo, recipeFromJsonLd, recipeFromText, recipeWithAi, type ImportedRecipe } from "./importRecipe.js";
import { parseIngredient } from "./ingredients.js";

// The recipe on a discovered post's page, shown before anything is saved. Opening a post reads
// it with plain code: the page's recipe data (schema.org), or, when the site keeps Culury out or
// has none, the feed post's own Ingredients / Instructions. AI only when asked: Read with AI,
// Calculate nutrition. Kept with the post for a day; Import saves it as shown.

type Post = typeof discoveryItems.$inferSelect;
interface Deps {
  db: Db;
  ai: AiService;
  fetchOptions: FetchOptions;
}

export const KEEP_MS = 24 * 3600_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The feed's copy of the post, as a page (read the same way as any page)
export function feedCopyOf(p: Pick<Post, "title" | "contentHtml" | "description">) {
  const body = p.contentHtml ?? (p.description ? `<p>${esc(p.description)}</p>` : "");
  return `<!DOCTYPE html><html><head><title>${esc(p.title)}</title></head><body><h1>${esc(p.title)}</h1>${body}</body></html>`;
}

// The page's text, for AI (the same as an import's)
function textOf(html: string, url: string) {
  const info = pageInfo(html, url);
  return [info.title && `Title: ${info.title}`, info.description && `Summary: ${info.description}`, info.videoDescription && `Video description:\n${info.videoDescription}`, info.text && `Page text:\n${info.text}`].filter(Boolean).join("\n\n");
}

async function fetchSite(link: string, fetchOptions: FetchOptions): Promise<{ html: string; url: string } | { error: string }> {
  try {
    const page = await fetchUrl(link, fetchOptions);
    if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) return { error: `The link is a ${page.contentType.split(";")[0]}, not a web page.` };
    return { html: page.body.toString("utf8"), url: page.url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const withSource = (r: ImportedRecipe, link: string, html: string | null, pageUrl: string): ImportedRecipe => {
  const info = html ? pageInfo(html, pageUrl) : null;
  const canonical = info?.canonical && /^https?:/.test(info.canonical) && new URL(info.canonical, pageUrl).hostname === new URL(link).hostname ? info.canonical : null;
  return { ...r, imageUrl: r.imageUrl ?? info?.image ?? null, sourceUrl: canonical ?? link, sourceName: r.sourceName ?? info?.siteName ?? new URL(link).hostname.replace(/^www\./, "") };
};

async function keep(db: Db, id: number, preview: RecipePreview) {
  await db.update(discoveryItems).set({ preview, previewAt: new Date() }).where(eq(discoveryItems.id, id));
  return preview;
}

// Plain code only
export async function readPreview(d: Deps, p: Post & { link: string }): Promise<RecipePreview> {
  const site = await fetchSite(p.link, d.fetchOptions);
  if ("html" in site) {
    const r = recipeFromJsonLd(site.html, site.url);
    if (r) return keep(d.db, p.id, { recipe: withSource(r, p.link, site.html, site.url), how: "schema.org", from: "site", problem: null });
  }
  const problem = "error" in site ? site.error : "The recipe's page has no recipe data Culury can read without AI.";
  const feed = feedCopyOf(p);
  const fromText = recipeFromText(pageInfo(feed, p.link).text ?? "");
  if (fromText) return keep(d.db, p.id, { recipe: withSource({ ...fromText, title: fromText.title || p.title }, p.link, null, p.link), how: "text", from: "feed", problem });
  return keep(d.db, p.id, { recipe: null, how: null, from: null, problem });
}

// Read with AI: the site's page text, else the feed's copy
export async function previewWithAi(d: Deps, p: Post & { link: string }): Promise<RecipePreview> {
  const site = await fetchSite(p.link, d.fetchOptions);
  const tries: { from: "site" | "feed"; text: string; html: string | null; url: string }[] = [];
  if ("html" in site) tries.push({ from: "site", text: textOf(site.html, site.url), html: site.html, url: site.url });
  tries.push({ from: "feed", text: textOf(feedCopyOf(p), p.link), html: null, url: p.link });
  let last: Error | null = null;
  for (const t of tries) {
    try {
      const r = await recipeWithAi(d.ai, t.text, `This is from ${p.link}.`);
      return keep(d.db, p.id, { recipe: withSource(r, p.link, t.html, t.url), how: "ai", from: t.from, problem: t.from === "feed" && "error" in site ? site.error : null });
    } catch (e) {
      if (!(e instanceof AiError) || /Settings › AI/.test(e.message)) throw e; // AI off: nothing else to try
      last = e;
    }
  }
  throw last!;
}

// Calculate nutrition: one ingredient at a time, added up per serving (the same as Re-analyze)
export async function previewNutrition(d: Deps, id: number, preview: RecipePreview): Promise<RecipePreview> {
  const r = preview.recipe!;
  const nutrition = await estimateNutrition(d.ai, { title: r.title, servings: r.servings ?? null, yieldText: r.yieldText ?? null, ingredients: r.ingredients.map(parseIngredient) });
  return keep(d.db, id, { ...preview, recipe: { ...r, nutrition } });
}

export const fresh = (p: Pick<Post, "preview" | "previewAt">) => (p.preview && p.previewAt && Date.now() - p.previewAt.getTime() < KEEP_MS ? p.preview : null);
