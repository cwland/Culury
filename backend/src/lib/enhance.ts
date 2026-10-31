import { asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { categories, recipeCategories, recipeSnapshots, recipes, recipeTags, tags, type Ingredient, type Nutrition, type RecipeSnapshot, type Step } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { HttpError } from "./errors.js";
import { isOn } from "./features.js";
import { cleanTag, loadRecipe, nutritionInput, refreshSearch, saveRecipe, type RecipeInput } from "./recipes.js";
import { AiError } from "./ai.js";
import { logEvent } from "./appLog.js";
import { notFound } from "./errors.js";

// AI Enhance: the AI checks a recipe (fills gaps in the steps, catches ingredient mistakes,
// estimates nutrition, suggests categories and tags). Checking saves nothing: the person picks
// which sections to keep in the wizard, and those are applied separately (with one level of undo).

export interface Section<T> {
  suggested: T;
  changes: string[]; // "What changed", in the AI's words
  changed: boolean; // differs from the recipe as it is
}
export interface Enhancement {
  steps: Section<string[]>;
  ingredients: Section<string[]>;
  nutrition: Section<Nutrition | null>;
  organize: { categories: string[]; newCategories: string[]; tags: string[]; changes: string[]; changed: boolean };
}

// Only when AI is ready and AI Enhance is on (Settings › AI)
export async function requireEnhance(db: Db, ai: AiService) {
  if (!(await ai.active("recipe"))) throw new HttpError(409, "AI Enhance needs AI. Turn it on in Settings › AI.");
  if (!(await isOn(db, "aiEnhance"))) throw new HttpError(409, "AI Enhance is turned off. Turn it on in Settings › AI.");
}

// Lines as the person sees them; a heading is "# Heading" (the editor and the save both read it back)
export const stepLines = (steps: Step[]) => steps.map((s) => (s.section ? `# ${s.section}` : s.text));
export const ingredientLines = (list: Ingredient[]) => list.map((i) => (i.section ? `# ${i.section}` : i.raw));

const SYSTEM = `You check home recipes and suggest careful fixes. Reply with JSON only, in this shape:
{"steps": ["..."], "stepChanges": ["..."],
 "ingredients": ["..."], "ingredientChanges": ["..."],
 "nutrition": {"calories": 0, "fat": 0, "saturatedFat": 0, "carbs": 0, "fiber": 0, "sugar": 0, "protein": 0, "sodium": 0, "note": ""}, "nutritionChanges": ["..."],
 "categories": ["..."], "tags": ["..."], "organizeChanges": ["..."]}
Rules:
- Keep the recipe's own wording. Change a step only to fix a mistake or add a missing detail (a time, a temperature, a doneness cue, a missing step). Keep every step; lines starting with "# " are headings, keep them.
- Ingredients: one per line, as written. Add an ingredient only if the steps use it and it's missing. Never change a quantity without saying why in ingredientChanges.
- Nutrition is for ONE serving: grams, except calories (kcal) and sodium (mg), from standard food tables (USDA). "note": one short sentence on what you assumed.
- Categories: choose from the household's categories. Suggest a new one only if none fits.
- Tags: lowercase, short. Reuse the household's existing tags rather than near-duplicates. Keep the recipe's tags unless one is wrong.
- Each ...Changes list: one short sentence per change, saying what and why. An empty list if nothing changed.
- If a section needs no change, return it exactly as given.`;

const textList = (v: unknown, maxItems: number, maxLen: number): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
  return out.length ? out : null; // empty: treat as left out (never wipes a section)
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => norm(x) === norm(b[i]));
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map((s) => s.toLowerCase()));
  const y = new Set(b.map((s) => s.toLowerCase()));
  return x.size === y.size && [...x].every((s) => y.has(s));
};
const num = (v: unknown, max = 100000) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};
const NUMBERS = ["calories", "fat", "saturatedFat", "carbs", "fiber", "sugar", "protein", "sodium"] as const;

function section<T>(current: T, suggested: T | null, changes: string[], same: (a: T, b: T) => boolean): Section<T> {
  if (suggested === null || same(current, suggested)) return { suggested: current, changes: [], changed: false };
  return { suggested, changes: changes.length ? changes : ["The AI changed this section."], changed: true };
}

export async function suggestEnhancements(db: Db, ai: AiService, recipeId: number): Promise<Enhancement> {
  await requireEnhance(db, ai);
  const r = await loadRecipe(db, recipeId, null);
  const household = (await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name))).map((c) => c.name);
  const known = (
    await db.select({ name: tags.name, n: count() }).from(tags).innerJoin(recipeTags, eq(recipeTags.tagId, tags.id)).groupBy(tags.name).orderBy(desc(count()), asc(tags.name)).limit(200)
  ).map((t) => t.name);

  const steps = stepLines(r.steps);
  const ingredients = ingredientLines(r.ingredients);
  const cats = r.categories.map((c) => c.name);
  const servings = r.servings ?? null;
  const shownNutrition = r.nutrition ? Object.fromEntries(NUMBERS.map((k) => [k, r.nutrition![k]])) : null;
  const user = [
    `Recipe: ${r.title}`,
    `Makes: ${servings ? `${servings} servings` : r.yieldText || "unknown (assume 4 servings)"}`,
    `Ingredients:\n${ingredients.map((l) => `- ${l}`).join("\n") || "(none)"}`,
    `Steps:\n${steps.map((l, i) => `${i + 1}. ${l}`).join("\n") || "(none)"}`,
    `Nutrition now (per serving): ${shownNutrition ? JSON.stringify(shownNutrition) : "none"}`,
    `Its categories: ${cats.join(", ") || "none"}`,
    `Its tags: ${r.tags.join(", ") || "none"}`,
    `The household's categories: ${household.join(", ") || "none"}`,
    `Tags already in use: ${known.join(", ") || "none"}`,
  ].join("\n\n");

  const { json, service } = await ai.ask("recipe", SYSTEM, user, { maxTokens: 6000 });
  // Readable JSON but none of the parts ({"error": ...}, {}): not "the recipe looks good"
  if (!["steps", "ingredients", "nutrition", "categories", "tags"].some((k) => json[k] != null)) {
    await logEvent(db, { category: "ai", level: "warning", source: service.name, event: `${service.name} sent no suggestions for “${r.title}”`, detail: `It said: ${JSON.stringify(json).slice(0, 600)}` });
    throw new AiError(`${service.name} didn't send any suggestions. Try again, or try another AI service.`);
  }
  const changesOf = (k: string) => textList(json[k], 10, 300) ?? [];

  // Instructions: numbering the AI may have kept is dropped
  const sSteps = textList(json.steps, 300, 10000)?.map((s) => s.replace(/^(?:step\s*)?\d+[.)]\s+/i, "")) ?? null;
  const sIngredients = textList(json.ingredients, 500, 1000)?.map((s) => s.replace(/^[-•*]\s+/, "")) ?? null;

  // Nutrition: only an estimate with calories counts
  let sNutrition: Nutrition | null = null;
  const n = json.nutrition as Record<string, unknown> | undefined;
  if (n && typeof n === "object" && num(n.calories, 20000) !== null) {
    sNutrition = {
      ...(Object.fromEntries(NUMBERS.map((k) => [k, num(n[k], k === "calories" ? 20000 : 100000)])) as Record<(typeof NUMBERS)[number], number | null>),
      source: "ai",
      servings: servings ?? (r.yieldText ? null : 4),
      note: typeof n.note === "string" && n.note.trim() ? n.note.trim().slice(0, 300) : null,
    };
  }
  const sameNutrition = (a: Nutrition | null, b: Nutrition | null) => (!a || !b ? a === b : NUMBERS.every((k) => (a[k] ?? null) === (b[k] ?? null)));

  // Categories: matched to the household's own names; anything else is new
  const byLower = new Map(household.map((c) => [c.toLowerCase(), c]));
  const sCats = textList(json.categories, 10, 100);
  const categoriesOut = sCats ? [...new Set(sCats.map((c) => byLower.get(c.toLowerCase()) ?? c))] : cats;
  const newCategories = categoriesOut.filter((c) => !byLower.has(c.toLowerCase()));
  const sTags = textList(json.tags, 30, 60);
  const tagsOut = sTags ? [...new Set(sTags.map(cleanTag).filter(Boolean))] : r.tags;
  const organizeChanged = !sameSet(categoriesOut, cats) || !sameSet(tagsOut, r.tags);
  const organizeChanges = organizeChanged ? (changesOf("organizeChanges").length ? changesOf("organizeChanges") : ["The AI changed the categories or tags."]) : [];

  return {
    steps: section(steps, sSteps, changesOf("stepChanges"), sameLines),
    ingredients: section(ingredients, sIngredients, changesOf("ingredientChanges"), sameLines),
    nutrition: section(r.nutrition ?? null, sNutrition, changesOf("nutritionChanges"), sameNutrition),
    organize: organizeChanged
      ? { categories: categoriesOut, newCategories, tags: tagsOut, changes: organizeChanges, changed: true }
      : { categories: cats, newCategories: [], tags: r.tags, changes: [], changed: false },
  };
}

// ---------- apply and undo ----------

// The sections the person kept in the wizard (each one optional)
export const applyInput = z
  .object({
    steps: z.array(z.string().max(10000)).max(300).optional(),
    ingredients: z.array(z.string().max(1000)).max(500).optional(),
    nutrition: nutritionInput.nullable().optional(),
    categories: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  })
  .strict();

// Keep the recipe as it is now (replacing any older snapshot: one level of undo), then save only
// the sections sent. New categories are created; tags are matched without case.
export async function applyEnhancements(db: Db, recipeId: number, body: z.infer<typeof applyInput>, userId: number | null) {
  // One transaction: if saving fails, the earlier undo point is kept and nothing changes
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(recipes).where(eq(recipes.id, recipeId));
    if (!r) throw notFound("Recipe");
    const categoryIds = (await tx.select({ id: recipeCategories.categoryId }).from(recipeCategories).where(eq(recipeCategories.recipeId, recipeId))).map((c) => c.id);
    const tagNames = (await tx.select({ name: tags.name }).from(recipeTags).innerJoin(tags, eq(tags.id, recipeTags.tagId)).where(eq(recipeTags.recipeId, recipeId))).map((t) => t.name);
    const applied: RecipeSnapshot["applied"] = [];
    if (body.steps) applied.push("steps");
    if (body.ingredients) applied.push("ingredients");
    if (body.nutrition !== undefined) applied.push("nutrition");
    if (body.categories || body.tags) applied.push("organize");
    const data: RecipeSnapshot = { steps: r.steps, ingredients: r.ingredients, nutrition: r.nutrition ?? null, categoryIds, tags: tagNames, applied };
    await tx
      .insert(recipeSnapshots)
      .values({ recipeId, data })
      .onConflictDoUpdate({ target: recipeSnapshots.recipeId, set: { data, createdAt: new Date() } });
    await saveRecipe(tx, recipeId, { steps: body.steps, ingredients: body.ingredients, nutrition: body.nutrition, categories: body.categories, tags: body.tags } as RecipeInput, userId);
  });
}

// Put back what the latest AI change replaced (only the sections it touched), exactly, and forget the snapshot
export async function undoEnhancements(db: Db, recipeId: number) {
  await db.transaction(async (tx) => {
    const [snap] = await tx.select().from(recipeSnapshots).where(eq(recipeSnapshots.recipeId, recipeId));
    if (!snap) throw new HttpError(404, "There's no AI change to undo on this recipe");
    const d = snap.data;
    const did = new Set(d.applied ?? ["steps", "ingredients", "nutrition", "organize"]);
    if (did.has("organize")) await saveRecipe(tx, recipeId, { categories: d.categoryIds, tags: d.tags } as RecipeInput, null);
    const back = { ...(did.has("steps") && { steps: d.steps }), ...(did.has("ingredients") && { ingredients: d.ingredients }), ...(did.has("nutrition") && { nutrition: d.nutrition }) };
    await tx.update(recipes).set({ ...back, updatedAt: new Date() }).where(eq(recipes.id, recipeId));
    await tx.delete(recipeSnapshots).where(eq(recipeSnapshots.recipeId, recipeId));
    await refreshSearch(tx, [recipeId]);
  });
}
