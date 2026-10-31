import type { Ingredient } from "../db/schema.js";

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
