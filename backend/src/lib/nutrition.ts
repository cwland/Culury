import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { jobs, recipes, type Ingredient } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { estimateNutrition } from "./aiHelpers.js";
import { logEvent } from "./appLog.js";
import type { EventBus } from "./events.js";
import { isOn } from "./features.js";
import type { JobQueue } from "./jobs.js";

// Keeping nutrition in step with the ingredients (the "Auto nutrition" switch).

// The ingredient lines that count for nutrition: no headings, and the same no matter the
// order, spacing or capital letters. A line listed twice is kept twice (it's twice as much).
const lines = (list: Pick<Ingredient, "raw" | "section">[]) =>
  list
    .filter((i) => !i.section)
    .map((i) => i.raw.trim().replace(/\s+/g, " ").toLowerCase())
    .sort();

// Did the ingredients change enough that nutrition worked out from them is out of date?
export function ingredientsChanged(before: Pick<Ingredient, "raw" | "section">[], after: Pick<Ingredient, "raw" | "section">[]) {
  const a = lines(before);
  const b = lines(after);
  return a.length !== b.length || a.some((line, i) => line !== b[i]);
}

// ---------- keeping it up to date ----------

interface Deps {
  db: Db;
  jobs: JobQueue;
}

// The ingredients of a recipe changed. With Auto nutrition on, nutrition is worked out again in
// the background (numbers you typed in are never replaced). Otherwise the numbers there are
// marked out of date, so the recipe can say so.
export async function ingredientsUpdated(d: Deps, recipeId: number) {
  const [r] = await d.db.select({ nutrition: recipes.nutrition }).from(recipes).where(eq(recipes.id, recipeId));
  if (!r) return;
  const auto = (await isOn(d.db, "ai")) && (await isOn(d.db, "autoNutrition"));
  if (auto && r.nutrition?.source !== "you") return nutritionSoon(d, recipeId);
  if (r.nutrition && !r.nutrition.outdated) {
    await d.db.update(recipes).set({ nutrition: { ...r.nutrition, outdated: true } }).where(eq(recipes.id, recipeId));
  }
}

// Queue a nutrition job for this recipe unless one is already waiting
async function nutritionSoon(d: Deps, recipeId: number) {
  const [waiting] = await d.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "nutrition"), eq(jobs.status, "queued"), sql`${jobs.payload}->>'recipeId' = ${String(recipeId)}`))
    .limit(1);
  if (!waiting) await d.jobs.enqueue("nutrition", { recipeId }, null);
}

export function registerNutritionJob(queue: JobQueue, d: { db: Db; ai: AiService; events: EventBus }) {
  queue.handle("nutrition", async (job) => {
    const recipeId = Number(job.payload.recipeId);
    const [r] = await d.db.select().from(recipes).where(eq(recipes.id, recipeId));
    // Gone, typed in meanwhile, or switched off since it was queued: nothing to do
    if (!r || r.nutrition?.source === "you" || !(await isOn(d.db, "ai")) || !(await isOn(d.db, "autoNutrition"))) return {};
    try {
      const nutrition = await estimateNutrition(d.ai, r);
      await d.db.update(recipes).set({ nutrition }).where(eq(recipes.id, recipeId));
    } catch (e) {
      await logEvent(d.db, { category: "ai", level: "error", source: "Auto nutrition", event: `Nutrition couldn't be worked out for ${r.title}`, detail: (e as Error).message });
      throw e;
    }
    d.events.emit({ topic: "recipes", id: recipeId, by: null });
    await logEvent(d.db, { category: "ai", level: "info", source: "Auto nutrition", event: `Nutrition worked out for ${r.title}` });
    return {};
  });
}
