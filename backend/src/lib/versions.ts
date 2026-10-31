import { and, desc, eq } from "drizzle-orm";
import { recipeVersions, recipes, type RecipeVersionData } from "../db/schema.js";
import type { Db } from "../db/index.js";
import { isOn } from "./features.js";
import type { Tx } from "./recipes.js";

// Recipe versions (the "Recipe versioning" switch). The recipe row always holds the active
// version's content; a version is a full copy of it. New versions come from adding a recipe (v1),
// the AI check and hand edits saved as new. Everything else that changes the recipe, nutrition
// included, goes into the active version, so it always matches the recipe, even while versioning
// is switched off.

type RecipeRow = typeof recipes.$inferSelect;
type Source = "import" | "created" | "ai" | "edit";

export function versionData(r: RecipeRow): RecipeVersionData {
  return {
    title: r.title,
    description: r.description,
    ingredients: r.ingredients,
    steps: r.steps,
    servings: r.servings,
    yieldText: r.yieldText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    notes: r.notes,
    nutrition: r.nutrition ?? null,
  };
}

// What changed between two versions, in words, in a fixed order. Servings and yield are one
// thing ("servings"), and so are the three times ("times").
const PARTS: [string, (keyof RecipeVersionData)[]][] = [
  ["title", ["title"]],
  ["description", ["description"]],
  ["ingredients", ["ingredients"]],
  ["steps", ["steps"]],
  ["servings", ["servings", "yieldText"]],
  ["times", ["prepMinutes", "cookMinutes", "totalMinutes"]],
  ["notes", ["notes"]],
  ["nutrition", ["nutrition"]],
];
export function changedParts(before: RecipeVersionData, after: RecipeVersionData) {
  const same = (k: keyof RecipeVersionData) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  return PARTS.filter(([, keys]) => keys.some((k) => !same(k))).map(([name]) => name);
}
// "the title", "ingredients and steps", "the times and notes"
export function describeParts(parts: string[]) {
  const list = parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return ["title", "description", "times"].includes(parts[0]) ? `the ${list}` : list;
}

async function load(db: Tx, recipeId: number) {
  const [r] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  return r ?? null;
}

async function count(db: Tx, recipeId: number) {
  return (await db.select({ id: recipeVersions.id }).from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId))).length;
}

async function insertVersion(db: Tx, r: RecipeRow, number: number, source: Source, summary: string, userId: number | null) {
  await db.update(recipeVersions).set({ active: false }).where(and(eq(recipeVersions.recipeId, r.id), eq(recipeVersions.active, true)));
  await db.insert(recipeVersions).values({ recipeId: r.id, number, source, summary, data: versionData(r), active: true, createdBy: userId });
}

// A recipe was just added: it's v1
export async function firstVersion(db: Tx, recipeId: number, source: "import" | "created", userId: number | null) {
  if (!(await isOn(db as Db, "recipeVersions"))) return;
  const r = await load(db, recipeId);
  if (r && !(await count(db, recipeId))) await insertVersion(db, r, 1, source, source === "import" ? "Imported" : "Added", userId);
}

// Before changing a recipe that has no versions yet (added while versioning was off): v1 is the
// recipe as it is now, so the version about to be made has something to go back to
export async function ensureVersions(db: Tx, recipeId: number) {
  if (!(await isOn(db as Db, "recipeVersions"))) return;
  const r = await load(db, recipeId);
  if (r && !(await count(db, recipeId))) await insertVersion(db, r, 1, r.sourceUrl ? "import" : "created", r.sourceUrl ? "Imported" : "Added", r.createdBy);
}

// The recipe was changed: it becomes a new active version (numbers keep counting up, even after
// a delete). With versioning off, the active version takes the change instead.
export async function newVersion(db: Tx, recipeId: number, source: "ai" | "edit", summary: string, userId: number | null) {
  if (!(await isOn(db as Db, "recipeVersions"))) return syncActive(db, recipeId);
  const r = await load(db, recipeId);
  if (!r) return;
  const [last] = await db.select({ number: recipeVersions.number }).from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId)).orderBy(desc(recipeVersions.number)).limit(1);
  await insertVersion(db, r, (last?.number ?? 0) + 1, source, summary, userId);
}

// The recipe was changed in place (saved to the current version, nutrition, versioning off):
// the active version gets the same content
export async function syncActive(db: Tx, recipeId: number) {
  const r = await load(db, recipeId);
  if (!r) return;
  await db
    .update(recipeVersions)
    .set({ data: versionData(r) })
    .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.active, true)));
}
