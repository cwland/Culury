import { asc, eq, ilike, sql } from "drizzle-orm";
import { readRecipeFile, type ReadResult } from "./fileImport.js";
import type { Db } from "../db/index.js";
import { categories, recipeUser, recipes, type JobResult } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { logEvent } from "./appLog.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { matchCategories, normalizeUrl, pageInfo, recipeFromJsonLd, recipeFromPhotos, recipeFromText, recipeWithAi, type ImportedRecipe } from "./importRecipe.js";
import type { JobQueue, JobRow } from "./jobs.js";
import type { Photos } from "./photos.js";
import { createRecipe, saveRecipe } from "./recipes.js";
import { recipeAdded } from "./nutrition.js";
import { firstVersion } from "./versions.js";
import { tidyIngredientLine } from "./ingredients.js";
import { recipesFromPdf } from "./pdfImport.js";

interface Deps {
  db: Db;
  ai: AiService;
  photos: Photos;
  fetchOptions: FetchOptions; // tests swap in fake pages
  jobs: JobQueue;
}

// A recipe already saved from this page, if any
export async function findDuplicate(db: Db, url: string) {
  const want = normalizeUrl(url);
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const rows = await db.select({ id: recipes.id, sourceUrl: recipes.sourceUrl }).from(recipes).where(ilike(recipes.sourceUrl, `%${host}%`));
  return rows.find((r) => r.sourceUrl && normalizeUrl(r.sourceUrl) === want)?.id ?? null;
}

// fromApp: a collection from your own recipe app, so its categories are yours (made if new) and its notes come too
async function store(d: Deps, r: ImportedRecipe & { notes?: string | null }, job: JobRow, how: JobResult["how"], fromApp = false): Promise<JobResult> {
  const warnings: string[] = [];
  let imageUrl = r.imageUrl ?? null;
  // Keep a copy of the picture here, so it stays even if the site changes or goes away
  if (imageUrl && /^https?:/i.test(imageUrl)) {
    try {
      imageUrl = await d.photos.download(imageUrl, d.fetchOptions);
    } catch (e) {
      warnings.push(`The photo couldn't be saved (${(e as Error).message}); it's linked from the site instead.`);
    }
  }
  const mine = await d.db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder));
  const input = createRecipe.parse({
    title: r.title.slice(0, 300),
    description: r.description?.slice(0, 5000) ?? null,
    ingredients: r.ingredients.slice(0, 500).map((i) => tidyIngredientLine(i.slice(0, 1000))), // "One pound of…" -> "1 lb…"
    steps: r.steps.slice(0, 300).map((s) => (typeof s === "string" ? s.slice(0, 10000) : { section: s.section.slice(0, 200) })),
    servings: r.servings ?? null,
    yieldText: r.yieldText ?? null,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    totalMinutes: r.totalMinutes ?? (r.prepMinutes || r.cookMinutes ? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) : null),
    sourceUrl: r.sourceUrl?.slice(0, 2000) ?? null,
    sourceName: r.sourceName?.slice(0, 200) ?? null,
    imageUrl,
    tags: (r.tags ?? []).map((t) => t.slice(0, 60)).slice(0, 12),
    categories: fromApp ? [...new Set((r.categories ?? []).map((c) => c.trim().slice(0, 100)).filter(Boolean))].slice(0, 20) : matchCategories(r.categories ?? [], mine),
    nutrition: r.nutrition ?? null,
    ...(fromApp && r.notes ? { notes: r.notes.slice(0, 20000) } : {}),
  });
  const recipeId = await saveRecipe(d.db, null, input, job.createdBy);
  await firstVersion(d.db, recipeId, "import", job.createdBy);
  // Nutrition (Auto nutrition): not for every recipe in a whole file, only one at a time.
  // Imported by a person: they're offered the AI check; with an API key, nobody is.
  if (how !== "file") await recipeAdded(d, recipeId, { offered: job.createdBy !== null });
  return { recipeId, title: input.title, how, ...(warnings.length ? { warnings } : {}) };
}

// Already saved from this page: skipped, and noted in Settings › Logs › Imports
async function alreadySaved(d: Deps, url: string, recipeId: number): Promise<JobResult> {
  const [r] = await d.db.select({ title: recipes.title }).from(recipes).where(eq(recipes.id, recipeId));
  await logEvent(d.db, { category: "import", level: "info", source: url.slice(0, 200), event: `Already saved: "${r?.title ?? "a recipe"}"` });
  return { duplicateOf: recipeId };
}

export function registerImportJobs(queue: JobQueue, d: Deps) {
  // A link: schema.org data on the page, or AI on the page's text (or a video's description)
  queue.handle("import-url", async (job) => {
    const { url, force } = job.payload as { url: string; force?: boolean };
    try {
      if (!force) {
        const dup = await findDuplicate(d.db, url);
        if (dup) return alreadySaved(d, url, dup);
      }
      const page = await fetchUrl(url, d.fetchOptions);
      if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType) throw new Error(`That link is a ${page.contentType.split(";")[0]}, not a web page. Reading recipes from photos and files comes later.`);
      const html = page.body.toString("utf8");
      const info = pageInfo(html, page.url);
      const sourceUrl = info.canonical && new URL(info.canonical).hostname === new URL(page.url).hostname ? info.canonical : page.url;
      if (!force && sourceUrl !== url) {
        const dup = await findDuplicate(d.db, sourceUrl);
        if (dup) return alreadySaved(d, url, dup);
      }
      const found = recipeFromJsonLd(html, page.url);
      let r: ImportedRecipe;
      let how: JobResult["how"];
      if (found) {
        r = found;
        how = "schema.org";
      } else {
        const text = [info.title && `Title: ${info.title}`, info.description && `Summary: ${info.description}`, info.videoDescription && `Video description:\n${info.videoDescription}`, info.text && `Page text:\n${info.text}`].filter(Boolean).join("\n\n");
        r = await recipeWithAi(d.ai, text, `This is from ${page.url}.`);
        how = "ai";
      }
      const result = await store(d, { ...r, imageUrl: r.imageUrl ?? info.image, sourceUrl, sourceName: info.siteName }, job, how);
      await logEvent(d.db, { category: "import", level: result.warnings ? "warning" : "info", source: info.siteName ?? url, event: `Imported "${result.title}"${how === "ai" ? " with AI" : ""}`, detail: result.warnings?.join(" ") ?? url });
      return result;
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: url.slice(0, 200), event: "Couldn't import a recipe", detail: (e as Error).message });
      throw e;
    }
  });

  // Pasted text: read directly when it has Ingredients / Instructions headings, otherwise with AI
  queue.handle("import-text", async (job) => {
    const { text } = job.payload as { text: string };
    try {
      const plainRead = recipeFromText(text);
      const r = plainRead ?? (await recipeWithAi(d.ai, text));
      const result = await store(d, r, job, plainRead ? "text" : "ai");
      await logEvent(d.db, { category: "import", level: "info", source: "Pasted text", event: `Imported "${result.title}"${plainRead ? "" : " with AI"}` });
      return result;
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: "Pasted text", event: "Couldn't import a recipe", detail: (e as Error).message });
      throw e;
    }
  });
}

// Photos of a recipe card or cookbook page, read by an AI service that can see pictures
export function registerPhotoImport(queue: JobQueue, d: Deps) {
  queue.handle("import-photo", async (job) => {
    const { files } = job.payload as { files: string[] };
    try {
      const buffers = await Promise.all(files.map((f) => d.photos.readIncoming(f)));
      const r = await recipeFromPhotos(d.ai, buffers.map((b) => ({ mime: "image/jpeg", base64: b.toString("base64") })));
      const imageUrl = r.dishPhoto ? await d.photos.save(buffers[r.dishPhoto - 1]) : null;
      const result = await store(d, { ...r, imageUrl, sourceName: r.sourceName ?? null }, job, "photo");
      await d.photos.removeIncoming(files);
      await logEvent(d.db, { category: "import", level: "info", source: "Photo", event: `Read "${result.title}" from ${files.length === 1 ? "a photo" : `${files.length} photos`}` });
      return result;
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: "Photo", event: "Couldn't read a recipe from a photo", detail: (e as Error).message });
      throw e;
    }
  });
}

// A recipe already saved that this one is a copy of: the same page, or the same name and ingredients
async function sameRecipe(db: Db, r: ImportedRecipe) {
  if (r.sourceUrl) {
    const dup = await findDuplicate(db, r.sourceUrl);
    if (dup) return dup;
  }
  const rows = await db.select({ id: recipes.id, ingredients: recipes.ingredients }).from(recipes).where(sql`lower(${recipes.title}) = ${r.title.toLowerCase()}`);
  // (as they'd be saved: "Two pounds of chuck" is saved as "2 lb chuck")
  const want = r.ingredients.map((l) => tidyIngredientLine(l).trim().toLowerCase()).join("\n");
  return rows.find((x) => x.ingredients.map((i) => i.raw.trim().toLowerCase()).join("\n") === want)?.id ?? null;
}

// A collection exported from another app (Paprika now; more formats in fileImport.ts)
export function registerFileImport(queue: JobQueue, d: Deps) {
  queue.handle("import-file", async (job) => {
    const { file, name } = job.payload as { file: string; name: string };
    try {
      const data = await d.photos.readIncoming(file);
      // A PDF is read by AI (one recipe or a whole cookbook); other files are another app's export
      const pdf = name.toLowerCase().endsWith(".pdf");
      const { format, recipes: found, problems }: ReadResult = pdf ? { format: "PDF", recipes: await recipesFromPdf(d.ai, data, name), problems: [] } : readRecipeFile(name, data);
      if (pdf && !found.length) throw new Error(`No recipes were found in ${name}.`);
      const recipeIds: number[] = [];
      let imported = 0;
      let skipped = 0;
      for (const r of found) {
        try {
          if (await sameRecipe(d.db, r)) {
            skipped++;
            continue;
          }
          const imageUrl = r.photo ? await d.photos.save(r.photo).catch(() => null) : r.imageUrl;
          // (one recipe from a PDF is treated like a single import: offered the AI check, nutrition after)
          const result = await store(d, { ...r, imageUrl: imageUrl ?? null }, job, pdf && found.length === 1 ? "pdf" : "file", !pdf);
          if (result.recipeId) recipeIds.push(result.recipeId);
          if (r.rating && job.createdBy && result.recipeId)
            await d.db
              .insert(recipeUser)
              .values({ recipeId: result.recipeId, userId: job.createdBy, rating: r.rating })
              .onConflictDoUpdate({ target: [recipeUser.recipeId, recipeUser.userId], set: { rating: r.rating } });
          imported++;
        } catch (e) {
          problems.push({ name: r.title, reason: (e as Error).message.split("\n")[0].slice(0, 200) });
        }
      }
      await d.photos.removeIncoming([file]);
      await logEvent(d.db, { category: "import", level: problems.length ? "warning" : "info", source: name.slice(0, 200), event: `Imported ${imported} recipe${imported === 1 ? "" : "s"} from ${format}`, detail: [skipped && `${skipped} already saved`, problems.length && `${problems.length} couldn't be used`].filter(Boolean).join(", ") || undefined });
      return { format, imported, skipped, recipeIds, problems: problems.slice(0, 200) };
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: name.slice(0, 200), event: "Couldn't import a recipe file", detail: (e as Error).message });
      throw e;
    }
  });
}

export const jobView = (j: JobRow) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  source: j.kind === "import-url" ? String((j.payload as { url?: string }).url ?? "") : j.kind === "import-file" ? String((j.payload as { name?: string }).name ?? "File") : j.kind === "import-photo" ? (((j.payload as { files?: string[] }).files?.length ?? 1) > 1 ? "Photos" : "Photo") : "Pasted text",
  result: j.result ?? null,
  error: j.error,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
});
