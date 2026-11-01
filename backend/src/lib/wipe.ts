import { isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { collections, jobs, mealPlan, recipes, tags } from "../db/schema.js";
import type { Photos } from "./photos.js";

// Settings › Data › Wipe all recipes (for testing imports from scratch). Every recipe goes, with
// what's tied to it (versions, favorites, ratings and notes, substitutions, category and tag links,
// collection places, meal plan entries for it, its photo) and the import history; tags and
// collections go too. Categories, the grocery list, the pantry, settings and people stay.
// (The route makes a backup first.)
export async function wipeRecipes(db: Db, photos: Photos) {
  const gone = await db.transaction(async (tx) => {
    const rows = await tx.select({ imageUrl: recipes.imageUrl }).from(recipes);
    await tx.delete(mealPlan).where(isNotNull(mealPlan.recipeId)); // (your own notes in the plan stay)
    await tx.execute(sql`delete from ${recipes}`); // versions, links, notes and substitutions go with them
    await tx.delete(tags);
    await tx.delete(collections);
    await tx.delete(jobs).where(sql`${jobs.kind} like 'import-%' or ${jobs.kind} = 'nutrition'`);
    return rows;
  });
  for (const r of gone) await photos.remove(r.imageUrl);
  return { recipes: gone.length };
}
