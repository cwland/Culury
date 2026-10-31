import { and, eq, gte, inArray, lte, desc, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { aisleChoices, groceryItems, mealPlan, pantryItems, recipes, type Ingredient, type Nutrition } from "../db/schema.js";
import { AiError, type AiService } from "./ai.js";
import { AISLE_IDS, itemKey } from "./grocery.js";
import type { JobQueue } from "./jobs.js";
import type { EventBus } from "./events.js";
import { logEvent } from "./appLog.js";

// The quick AI jobs: nutrition estimates, sorting grocery items into aisles, and meal ideas.

const num = (v: unknown, max = 100000) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};

// ---------- nutrition ----------

const NUTRITION_SYSTEM = `You estimate nutrition for recipes. Reply with JSON only:
{"calories": 0, "fat": 0, "saturatedFat": 0, "carbs": 0, "fiber": 0, "sugar": 0, "addedSugar": 0, "protein": 0, "sodium": 0, "servingSize": "", "note": ""}
Values are for ONE serving: grams, except calories (kcal) and sodium (mg). "sugar" is total sugars; "addedSugar" is the part from added sugar, syrup, honey and the like (not fruit or milk). "servingSize": how much one serving is, in kitchen measures with an approximate weight, like "About 1½ cups (340 g)". Use typical values from standard food tables (USDA) for the ingredients and amounts given, divided by the number of servings. If an amount is missing, assume a typical amount. "note": one short sentence on what you assumed, or "".`;

export async function estimateNutrition(ai: AiService, r: { title: string; servings: number | null; yieldText: string | null; ingredients: Ingredient[] }): Promise<Nutrition> {
  const lines = r.ingredients.filter((i) => !i.section).map((i) => `- ${i.raw}`);
  if (!lines.length) throw new AiError("Add the ingredients first: nutrition is worked out from them.");
  const servings = r.servings ?? null;
  const user = `Recipe: ${r.title}\nMakes: ${servings ? `${servings} servings` : r.yieldText || "unknown (assume 4 servings)"}\nIngredients:\n${lines.join("\n")}`;
  const { json } = await ai.ask("quick", NUTRITION_SYSTEM, user, { maxTokens: 400 });
  const out: Nutrition = {
    calories: num(json.calories, 20000),
    fat: num(json.fat),
    saturatedFat: num(json.saturatedFat),
    carbs: num(json.carbs),
    fiber: num(json.fiber),
    sugar: num(json.sugar),
    addedSugar: num(json.addedSugar),
    protein: num(json.protein),
    sodium: num(json.sodium),
    source: "ai",
    servings: servings ?? (r.yieldText ? null : 4),
    servingSize: typeof json.servingSize === "string" && json.servingSize.trim() ? json.servingSize.trim().slice(0, 100) : null,
    note: typeof json.note === "string" && json.note.trim() ? json.note.trim().slice(0, 300) : null,
  };
  if (out.calories === null) throw new AiError("The AI didn't give a calorie estimate. Try again.");
  return out;
}

// ---------- grocery aisles ----------

const AISLE_SYSTEM = `You sort grocery items into supermarket aisles. The aisles are: ${AISLE_IDS.join(", ")}.
Reply with JSON only: {"aisles": {"<item exactly as given>": "<aisle>"}}. Use "other" only when nothing fits.`;

// Items the word list couldn't place ("other"): ask AI, and remember the answer for next time
// (a later "pizza dough" goes straight to the same aisle without asking).
export function registerAisleSorting(queue: JobQueue, d: { db: Db; ai: AiService; events: EventBus }) {
  queue.handle("sort-aisles", async () => {
    const items = await d.db.select({ id: groceryItems.id, name: groceryItems.name }).from(groceryItems).where(and(eq(groceryItems.aisle, "other"), eq(groceryItems.aisleBy, "words")));
    const pantry = await d.db.select({ id: pantryItems.id, name: pantryItems.name }).from(pantryItems).where(eq(pantryItems.aisle, "other"));
    const names = [...new Set([...items, ...pantry].map((i) => i.name))].slice(0, 60);
    if (!names.length || !(await d.ai.active("quick"))) return { sorted: 0 };
    const { json } = await d.ai.ask("quick", AISLE_SYSTEM, names.map((n) => `- ${n}`).join("\n"), { maxTokens: 1500 });
    const given = (json.aisles && typeof json.aisles === "object" ? json.aisles : json) as Record<string, unknown>;
    const byKey = new Map<string, string>();
    for (const [name, aisle] of Object.entries(given))
      if (typeof aisle === "string" && aisle !== "other" && (AISLE_IDS as readonly string[]).includes(aisle)) {
        byKey.set(itemKey(name), aisle);
        await rememberAisle(d.db, name, aisle, "ai");
      }
    let sorted = 0;
    for (const i of items) {
      const aisle = byKey.get(itemKey(i.name));
      // asked once: left in Other if AI couldn't place it either (you can still move it)
      await d.db.update(groceryItems).set({ aisle: aisle ?? "other", aisleBy: "ai" }).where(eq(groceryItems.id, i.id));
      if (aisle) sorted++;
    }
    for (const p of pantry) {
      const aisle = byKey.get(itemKey(p.name));
      if (aisle) (await d.db.update(pantryItems).set({ aisle }).where(eq(pantryItems.id, p.id)), sorted++);
    }
    if (sorted) {
      d.events.emit({ topic: "grocery", by: null });
      d.events.emit({ topic: "pantry", by: null });
      await logEvent(d.db, { category: "ai", level: "info", source: "Grocery list", event: `Sorted ${sorted} item${sorted === 1 ? "" : "s"} into aisles` });
    }
    return { sorted };
  });
}

// Queue a sort unless one is already waiting
export async function sortAislesSoon(db: Db, queue: JobQueue) {
  if (await queue.pending("sort-aisles")) return;
  await queue.enqueue("sort-aisles", {}, null);
}

// The aisle you (or AI) chose for these items before, if any
export async function learnedAisles(db: Db, names: string[]): Promise<Map<string, string>> {
  const keys = [...new Set(names.map(itemKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = await db.select().from(aisleChoices).where(inArray(aisleChoices.key, keys));
  return new Map(rows.map((r) => [r.key, r.aisle]));
}
// Remember a choice (yours wins over AI's: AI never overwrites one you made)
export async function rememberAisle(db: Db, name: string, aisle: string, by: "ai" | "you") {
  const key = itemKey(name);
  if (!key) return;
  await db
    .insert(aisleChoices)
    .values({ key, aisle, by })
    .onConflictDoUpdate({ target: aisleChoices.key, set: { aisle, by, updatedAt: new Date() }, ...(by === "ai" ? { setWhere: sql`${aisleChoices.by} = 'ai'` } : {}) });
}

// ---------- meal ideas ----------

export interface MealIdea {
  title: string;
  why: string;
  recipeId: number | null; // one of your recipes, or null for a new idea
  uses: string[]; // pantry items it uses
}

const IDEAS_SYSTEM = `You suggest meals for a household. Reply with JSON only:
{"ideas": [{"title": "", "why": "", "recipeId": null, "uses": [""]}]}
Give 6 ideas. Prefer their own recipes (use the exact id from the list) when they fit, and add a few new ideas (recipeId null) for variety. Favor what's in the pantry, especially things that expire soon, and avoid repeating what they ate recently. "why": one short sentence. "uses": pantry items it uses.`;

export async function mealIdeas(db: Db, ai: AiService, opts: { ask?: string; today: string }): Promise<MealIdea[]> {
  const pantry = await db.select({ name: pantryItems.name, staple: pantryItems.staple, expiresOn: pantryItems.expiresOn }).from(pantryItems);
  const mine = await db.select({ id: recipes.id, title: recipes.title }).from(recipes).orderBy(desc(recipes.updatedAt)).limit(300);
  const from = new Date(`${opts.today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 28);
  const recent = await db
    .select({ title: mealPlan.title, recipe: recipes.title })
    .from(mealPlan)
    .leftJoin(recipes, eq(recipes.id, mealPlan.recipeId))
    .where(and(gte(mealPlan.date, from.toISOString().slice(0, 10)), lte(mealPlan.date, opts.today)));
  const user = [
    opts.ask ? `They asked for: ${opts.ask}` : "",
    `Pantry: ${pantry.filter((p) => !p.staple).map((p) => (p.expiresOn ? `${p.name} (use by ${p.expiresOn})` : p.name)).join(", ") || "(empty)"}`,
    `Staples they always have: ${pantry.filter((p) => p.staple).map((p) => p.name).join(", ") || "(none listed)"}`,
    `Eaten in the last 4 weeks: ${[...new Set(recent.map((r) => r.recipe ?? r.title).filter(Boolean))].join(", ") || "(nothing planned)"}`,
    `Their recipes (id: title):\n${mine.map((r) => `${r.id}: ${r.title}`).join("\n") || "(none yet)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { json } = await ai.ask("quick", IDEAS_SYSTEM, user, { maxTokens: 1500 });
  const ids = new Set(mine.map((r) => r.id));
  const list = Array.isArray(json.ideas) ? json.ideas : Array.isArray(json) ? json : [];
  return (list as Record<string, unknown>[])
    .filter((i) => i && typeof i.title === "string" && i.title.trim())
    .slice(0, 8)
    .map((i) => {
      const id = typeof i.recipeId === "number" ? i.recipeId : typeof i.recipeId === "string" && /^\d+$/.test(i.recipeId) ? Number(i.recipeId) : null;
      const recipeId = id !== null && ids.has(id) ? id : null;
      return {
        title: recipeId ? mine.find((r) => r.id === recipeId)!.title : String(i.title).trim().slice(0, 200),
        why: typeof i.why === "string" ? i.why.trim().slice(0, 300) : "",
        recipeId,
        uses: (Array.isArray(i.uses) ? i.uses : []).filter((u): u is string => typeof u === "string").slice(0, 8),
      };
    });
}
