// Recipe shapes from the API, and small helpers the recipe screens share

export interface Ingredient {
  raw: string;
  quantity?: number | null;
  quantityMax?: number | null;
  unit?: string | null;
  name?: string;
  note?: string | null;
  section?: string | null; // a heading instead of an ingredient
}

export interface Step {
  text: string;
  section?: string | null; // a heading instead of a step
}

export interface Named {
  id: number;
  name: string;
}

export interface Substitution {
  id: number;
  original: string;
  replacement: string;
  note: string | null;
  createdAt: string;
}

export interface Mine {
  favorite: boolean;
  pinned: boolean;
  rating: number | null;
  notes: string | null;
}

export interface Recipe {
  id: number;
  title: string;
  description: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  categories: Named[];
  collections: Named[];
  me: Mine;
  substitutions: Substitution[];
  nutrition: Nutrition | null;
}

// Per serving: grams, calories in kcal, sodium in mg
export interface Nutrition {
  calories: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null;
  protein: number | null;
  sodium: number | null;
  source: "site" | "ai" | "you";
  servings?: number | null;
  note?: string | null;
}
// A points-style estimate (like the ones diet programs use) from calories, saturated fat, sugar and
// protein. Approximate, not any program's official number.
export function pointsEstimate(n: Nutrition): number | null {
  if (n.calories === null) return null;
  return Math.max(0, Math.round(n.calories * 0.0305 + (n.saturatedFat ?? 0) * 0.275 + (n.sugar ?? 0) * 0.12 - (n.protein ?? 0) * 0.098));
}

export interface RecipeSummary {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  servings: number | null;
  yieldText: string | null;
  totalMinutes: number | null;
  sourceName: string | null;
  favorite: boolean;
  pinned: boolean;
  rating: number | null;
  tags: string[];
  updatedAt: string;
}

export interface TagInfo extends Named {
  count: number;
}
export interface CollectionInfo extends Named {
  description: string | null;
  count: number;
  images: string[];
}

// 95 -> "1 hr 35 min"
export function formatMinutes(m: number | null | undefined) {
  if (!m) return null;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return [h ? `${h} hr` : "", min ? `${min} min` : ""].filter(Boolean).join(" ");
}

// "www.seriouseats.com" from a link
export function siteName(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const FRACTIONS: [number, string][] = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"]];
// 1.5 -> "1½", 0.333 -> "⅓"
export function formatQuantity(n: number) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (near) return `${whole || ""}${near[1]}`;
  return String(Math.round(n * 100) / 100);
}

// Text for the editor: ingredients one per line (headings end with ":"), steps with a blank line between
export const ingredientsText = (list: Ingredient[]) => list.map((i) => (i.section ? `${i.section}:` : i.raw)).join("\n");
export const stepsText = (list: Step[]) => list.map((s) => (s.section ? `# ${s.section}` : s.text)).join("\n\n");

// Recipes page addresses: #/recipes, #/recipes?tag=x, #/recipes/12, #/recipes/12/edit, #/recipes/12/cook, #/recipes/new
export type RecipeRoute = { view: "away" } | { view: "list"; params: URLSearchParams } | { view: "recipe"; id: number } | { view: "edit"; id: number } | { view: "cook"; id: number } | { view: "new" };
export function recipeRoute(): RecipeRoute {
  const [path, query] = window.location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean); // ["recipes", "12", "edit"]
  if (parts[0] !== "recipes") return { view: "away" }; // leaving for another section
  if (parts[1] === "new") return { view: "new" };
  const id = Number(parts[1]);
  if (id > 0) return parts[2] === "edit" ? { view: "edit", id } : parts[2] === "cook" ? { view: "cook", id } : { view: "recipe", id };
  return { view: "list", params: new URLSearchParams(query ?? "") };
}

// The list as you last left it (search, collection, tag...), for the recipe page's back link
let lastList = "#/recipes";
export const rememberList = (hash: string) => void (lastList = hash);
export const listAddress = () => lastList;

// Word units read naturally: "3 cloves", "2 cans" (abbreviations like tbsp and g stay as they are)
const PLURAL: Record<string, string> = { pinch: "pinches", dash: "dashes", box: "boxes", bunch: "bunches", inch: "inches" };
const WORD_UNITS = new Set(["cup", "clove", "can", "jar", "bottle", "package", "bag", "stick", "slice", "piece", "sprig", "head", "stalk", "handful", "scoop", "sheet", "strip", "fillet", "drop", ...Object.keys(PLURAL)]);
export function unitLabel(unit: string | null | undefined, amount: number | null | undefined) {
  if (!unit) return "";
  if (!WORD_UNITS.has(unit) || !amount || amount <= 1) return unit;
  return PLURAL[unit] ?? `${unit}s`;
}

// ---------- grocery and pantry ----------

export interface ItemSource {
  recipeId?: number;
  title: string;
}
export interface GroceryItem {
  id: number;
  listId: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: string;
  checked: boolean;
  sources: ItemSource[];
}
export interface GroceryList {
  id: number;
  name: string;
  open: number;
  done: number;
}
export interface PantryItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  staple: boolean;
  expiresOn: string | null;
  note: string | null;
}
export interface PreviewLine {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  sources: ItemSource[];
  pantry: { id: number; name: string; staple: boolean; quantity: number | null; unit: string | null } | null;
}
export const AISLE_NAMES: Record<string, string> = {
  produce: "Produce",
  meat: "Meat & Seafood",
  dairy: "Dairy & Eggs",
  bakery: "Bakery",
  pantry: "Pantry",
  spices: "Spices & Seasonings",
  frozen: "Frozen",
  beverages: "Drinks",
  snacks: "Snacks",
  household: "Household",
  other: "Other",
};
export const AISLE_ORDER = Object.keys(AISLE_NAMES);

// "2¼ cups", "3", "" (just "some")
export function itemAmount(i: { quantity: number | null; unit: string | null }) {
  if (i.quantity === null) return i.unit ?? "";
  // shopping amounts: to the nearest kitchen fraction (2.19 cups -> 2¼ cups)
  const whole = Math.floor(i.quantity);
  const snaps = [0, 1, ...FRACTIONS.map(([v]) => v)];
  const frac = snaps.reduce((a, b) => (Math.abs(b - (i.quantity! - whole)) < Math.abs(a - (i.quantity! - whole)) ? b : a));
  const q = Math.max(whole + frac, FRACTIONS[0]?.[0] ?? 0.125);
  return [formatQuantity(q), unitLabel(i.unit, q)].filter(Boolean).join(" ");
}
