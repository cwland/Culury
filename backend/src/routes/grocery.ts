import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { groceryItems, groceryLists, mealPlan, pantryItems, recipes, type ItemSource } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam, idList, isoDate } from "../lib/validation.js";
import { parseIngredient } from "../lib/ingredients.js";
import { learnedAisles, rememberAisle, sortAislesSoon } from "../lib/aiHelpers.js";
import { AISLE_IDS, AISLES, addable, convertTo, guessAisle, itemKey, round, sameItem, splitLine, tidy } from "../lib/grocery.js";
import { userOf } from "./recipes.js";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Line {
  name: string;
  quantity: number | null;
  unit: string | null;
  note?: string | null;
  sources?: ItemSource[];
}

const lineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100000).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  sources: z.array(z.object({ recipeId: z.number().int().optional(), title: z.string().max(300) })).max(50).optional(),
});
// "2 lb chicken thighs" -> a line
export const lineFromText = (text: string): Line => {
  const p = parseIngredient(text);
  return { name: (p.name ?? text).slice(0, 200), quantity: p.quantity ?? null, unit: p.unit ?? null, note: p.note ?? null };
};
const linesFrom = (body: unknown): Line[] => {
  const b = z
    .union([
      z.object({ text: z.string().trim().min(1).max(5000) }).strict(), // one or more lines of text
      lineSchema.strict(),
      z.object({ items: z.array(lineSchema).min(1).max(300) }).strict(),
    ])
    .parse(body);
  // one per line; "eggs, 2 lb chicken, milk" is three, but "2 lb chicken, cubed" is one with a note
  if ("text" in b)
    return b.text
      .split(/\r?\n/)
      .flatMap(splitLine)
      .map((t) => t.trim())
      .filter(Boolean)
      .map(lineFromText);
  if ("items" in b) return b.items.map((l) => ({ ...l, quantity: l.quantity ?? null, unit: l.unit ?? null }));
  return [{ ...b, quantity: b.quantity ?? null, unit: b.unit ?? null }];
};

const mergeSources = (a: ItemSource[], b: ItemSource[] = []) => [...a, ...b.filter((s) => !a.some((x) => x.title === s.title))].slice(0, 20);

// Add lines to a list: the same thing (not yet checked off) gets the amounts added together
export async function addToList(tx: Tx, listId: number, lines: Line[], by: number | null) {
  const open = await tx.select().from(groceryItems).where(and(eq(groceryItems.listId, listId), eq(groceryItems.checked, false)));
  const learned = await learnedAisles(tx as unknown as Db, lines.map((l) => l.name));
  let [{ n: next }] = await tx.select({ n: sql<number>`coalesce(max(${groceryItems.position}), -1) + 1` }).from(groceryItems).where(eq(groceryItems.listId, listId));
  next = Number(next);
  const result = { added: 0, merged: 0 };
  for (const l of lines) {
    const same = open.find((i) => itemKey(i.name) === itemKey(l.name) && addable(i.unit, l.unit) && (i.quantity === null) === (l.quantity === null));
    if (same) {
      const t = same.quantity !== null && l.quantity !== null ? tidy(same.quantity + convertTo(l.quantity, l.unit, same.unit), same.unit) : { quantity: same.quantity, unit: same.unit };
      const quantity = t.quantity;
      const sources = mergeSources(same.sources, l.sources);
      const note = l.note && same.note !== l.note && !same.note?.includes(l.note) ? [same.note, l.note].filter(Boolean).join("; ") : same.note;
      await tx.update(groceryItems).set({ quantity, unit: t.unit, sources, note, updatedAt: new Date() }).where(eq(groceryItems.id, same.id));
      Object.assign(same, { quantity, unit: t.unit, sources, note });
      result.merged++;
    } else {
      const [row] = await tx
        .insert(groceryItems)
        .values({ listId, name: l.name, quantity: l.quantity, unit: l.unit, note: l.note ?? null, sources: l.sources ?? [], aisle: learned.get(itemKey(l.name)) ?? guessAisle(l.name), aisleBy: learned.has(itemKey(l.name)) ? "ai" : "words", position: next++, addedBy: by })
        .returning();
      open.push(row);
      result.added++;
    }
  }
  return result;
}

// Pantry: add, or top up what's there
export async function addToPantry(tx: Tx, lines: (Line & { staple?: boolean; expiresOn?: string | null })[]) {
  const have = await tx.select().from(pantryItems);
  const learned = await learnedAisles(tx as unknown as Db, lines.map((l) => l.name));
  let added = 0;
  for (const l of lines) {
    const same = have.find((p) => itemKey(p.name) === itemKey(l.name));
    if (same) {
      const quantity = same.quantity !== null && l.quantity !== null && addable(same.unit, l.unit) ? round(same.quantity + convertTo(l.quantity, l.unit, same.unit)) : (same.quantity ?? l.quantity);
      await tx.update(pantryItems).set({ quantity, unit: same.quantity === null ? l.unit : same.unit, staple: l.staple ?? same.staple, expiresOn: l.expiresOn ?? same.expiresOn, updatedAt: new Date() }).where(eq(pantryItems.id, same.id));
    } else {
      const [row] = await tx.insert(pantryItems).values({ name: l.name, quantity: l.quantity, unit: l.unit, note: l.note ?? null, aisle: learned.get(itemKey(l.name)) ?? guessAisle(l.name), staple: l.staple ?? false, expiresOn: l.expiresOn ?? null }).returning();
      have.push(row);
      added++;
    }
  }
  return added;
}

const aisleOrder = sql`array_position(array[${sql.join(AISLE_IDS.map((a) => sql`${a}`), sql`, `)}]::text[], ${groceryItems.aisle})`;

export default async function groceryRoutes(app: FastifyInstance) {
  const { db } = app;
  const changed = (req: FastifyRequest, topic: "grocery" | "pantry", id?: number) => {
    app.events.emit({ topic, id, by: userOf(req) });
    void sortUnknown();
  };
  // Anything the word list couldn't place goes to AI to sort (when AI is on)
  const sortUnknown = async () => {
    try {
      const [g] = await db.select({ id: groceryItems.id }).from(groceryItems).where(and(eq(groceryItems.aisle, "other"), eq(groceryItems.aisleBy, "words"))).limit(1);
      if (g && (await app.ai.active("quick"))) await sortAislesSoon(db, app.jobs);
    } catch {
      // sorting is a nicety
    }
  };

  const listOr404 = async (id: number) => {
    const [l] = await db.select().from(groceryLists).where(eq(groceryLists.id, id));
    if (!l) throw notFound("List");
    return l;
  };
  const firstList = async () => {
    const [l] = await db.select().from(groceryLists).orderBy(asc(groceryLists.sortOrder), asc(groceryLists.id)).limit(1);
    if (l) return l;
    const [made] = await db.insert(groceryLists).values({ name: "Groceries" }).returning();
    return made;
  };
  const items = (listId: number) => db.select().from(groceryItems).where(eq(groceryItems.listId, listId)).orderBy(asc(groceryItems.checked), aisleOrder, asc(groceryItems.position), asc(groceryItems.id));

  app.get("/api/grocery/aisles", async () => AISLES);

  // ---------- lists ----------
  app.get("/api/grocery/lists", async () =>
    db
      .select({
        id: groceryLists.id,
        name: groceryLists.name,
        open: sql<number>`(select count(*)::int from grocery_items gi where gi.list_id = "grocery_lists"."id" and not gi.checked)`,
        done: sql<number>`(select count(*)::int from grocery_items gi where gi.list_id = "grocery_lists"."id" and gi.checked)`,
      })
      .from(groceryLists)
      .orderBy(asc(groceryLists.sortOrder), asc(groceryLists.id))
  );
  app.post("/api/grocery/lists", async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1, "Name the list").max(100) }).strict().parse(req.body);
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${groceryLists.sortOrder}), -1) + 1` }).from(groceryLists);
    const [row] = await db.insert(groceryLists).values({ name, sortOrder: Number(n) }).returning();
    changed(req, "grocery");
    return reply.status(201).send({ ...row, open: 0, done: 0 });
  });
  app.patch("/api/grocery/lists/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(req.body);
    await listOr404(id);
    const [row] = await db.update(groceryLists).set({ name }).where(eq(groceryLists.id, id)).returning();
    changed(req, "grocery");
    return row;
  });
  app.delete("/api/grocery/lists/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(groceryLists);
    if (n <= 1) throw new HttpError(400, "Keep at least one list");
    const gone = await db.delete(groceryLists).where(eq(groceryLists.id, id)).returning({ id: groceryLists.id });
    if (!gone.length) throw notFound("List");
    changed(req, "grocery");
    return reply.status(204).send();
  });

  // ---------- items ----------
  app.get("/api/grocery/lists/:id/items", async (req) => {
    const { id } = idParam.parse(req.params);
    await listOr404(id);
    return items(id);
  });

  // Add: { text: "2 lb chicken\neggs" }, one { name, quantity, unit }, or { items: [...] }
  app.post("/api/grocery/lists/:id/items", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await listOr404(id);
    const result = await db.transaction((tx) => addToList(tx, id, linesFrom(req.body), userOf(req)));
    changed(req, "grocery", id);
    return reply.status(201).send({ ...result, items: await items(id) });
  });
  // The same, onto the first list (for Home Assistant, Shortcuts, voice assistants)
  app.post("/api/grocery/items", async (req, reply) => {
    const list = await firstList();
    const result = await db.transaction((tx) => addToList(tx, list.id, linesFrom(req.body), userOf(req)));
    changed(req, "grocery", list.id);
    return reply.status(201).send({ listId: list.id, ...result });
  });

  app.patch("/api/grocery/items/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        checked: z.boolean().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        quantity: z.number().positive().max(100000).nullable().optional(),
        unit: z.string().trim().max(20).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        aisle: z.enum(AISLE_IDS).optional(),
        listId: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    if (body.listId) await listOr404(body.listId);
    const [row] = await db
      .update(groceryItems)
      .set({
        ...body,
        ...(body.checked !== undefined ? { checkedAt: body.checked ? new Date() : null } : {}),
        ...(body.aisle ? { aisleBy: "you" as const } : {}),
        ...(body.name && !body.aisle ? { aisle: guessAisle(body.name) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(groceryItems.id, id))
      .returning();
    if (!row) throw notFound("Item");
    if (body.aisle) await rememberAisle(db, row.name, body.aisle, "you");
    changed(req, "grocery", row.listId);
    return row;
  });

  app.delete("/api/grocery/items/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(groceryItems).where(eq(groceryItems.id, id)).returning();
    if (!row) throw notFound("Item");
    changed(req, "grocery", row.listId);
    return reply.status(204).send();
  });

  // Done shopping: take the checked items off (optionally putting them in the pantry)
  app.post("/api/grocery/lists/:id/clear-checked", async (req) => {
    const { id } = idParam.parse(req.params);
    const { toPantry } = z.object({ toPantry: z.boolean().optional() }).strict().parse(req.body ?? {});
    await listOr404(id);
    const done = await db.transaction(async (tx) => {
      const rows = await tx.delete(groceryItems).where(and(eq(groceryItems.listId, id), eq(groceryItems.checked, true))).returning();
      if (toPantry && rows.length) await addToPantry(tx, rows.map((r) => ({ name: r.name, quantity: r.quantity, unit: r.unit })));
      return rows.length;
    });
    changed(req, "grocery", id);
    if (toPantry) changed(req, "pantry");
    return { removed: done };
  });

  // ---------- recipes and the plan onto a list ----------
  // What these recipes need, added up, with what the pantry already has. Nothing is added yet:
  // the app shows this so you can untick what you have, then sends the rest to the list.
  app.post("/api/grocery/preview", async (req) => {
    const body = z
      .union([
        z.object({ recipes: z.array(z.object({ recipeId: z.number().int().positive(), servings: z.number().positive().max(1000).nullable().optional() })).min(1).max(100) }).strict(),
        z.object({ from: isoDate, to: isoDate }).strict(),
      ])
      .parse(req.body);
    const wanted =
      "recipes" in body
        ? body.recipes
        : (await db.select({ recipeId: mealPlan.recipeId, servings: mealPlan.servings }).from(mealPlan).where(and(gte(mealPlan.date, body.from), lte(mealPlan.date, body.to)))).filter((r): r is { recipeId: number; servings: number | null } => r.recipeId !== null);
    const found = wanted.length ? await db.select({ id: recipes.id, title: recipes.title, servings: recipes.servings, ingredients: recipes.ingredients }).from(recipes).where(inArray(recipes.id, [...new Set(wanted.map((w) => w.recipeId))])) : [];
    const pantry = await db.select().from(pantryItems);
    const lines: (Line & { key: string; pantry: { id: number; name: string; staple: boolean; quantity: number | null; unit: string | null } | null })[] = [];
    for (const w of wanted) {
      const r = found.find((x) => x.id === w.recipeId);
      if (!r) continue;
      const factor = w.servings && r.servings ? w.servings / r.servings : 1;
      for (const ing of r.ingredients) {
        if (ing.section) continue;
        const name = ing.name ?? ing.raw;
        const q = ing.quantity ? round((ing.quantityMax ?? ing.quantity) * factor) : null;
        const source = { recipeId: r.id, title: r.title };
        const same = lines.find((l) => l.key === itemKey(name) && addable(l.unit, ing.unit ?? null) && (l.quantity === null) === (q === null));
        if (same) {
          if (same.quantity !== null && q !== null) same.quantity = round(same.quantity + convertTo(q, ing.unit ?? null, same.unit));
          same.sources = mergeSources(same.sources ?? [], [source]);
          continue;
        }
        const p = pantry.find((x) => sameItem(x.name, name));
        lines.push({ key: itemKey(name), name, quantity: q, unit: ing.unit ?? null, note: null, sources: [source], pantry: p ? { id: p.id, name: p.name, staple: p.staple, quantity: p.quantity, unit: p.unit } : null });
      }
    }
    return { recipes: found.length, lines: await (async () => {
        const learned = await learnedAisles(db, lines.map((l) => l.name));
        return lines.map((l) => ({ ...l, ...(l.quantity !== null ? tidy(l.quantity, l.unit) : {}), aisle: learned.get(l.key) ?? guessAisle(l.name) }));
      })() };
  });

  // ---------- pantry ----------
  app.get("/api/pantry", async () => db.select().from(pantryItems).orderBy(sql`array_position(array[${sql.join(AISLE_IDS.map((a) => sql`${a}`), sql`, `)}]::text[], ${pantryItems.aisle})`, asc(pantryItems.name)));

  app.post("/api/pantry", async (req, reply) => {
    const extra = z.object({ staple: z.boolean().optional(), expiresOn: isoDate.nullable().optional() }).partial();
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const { staple, expiresOn, ...rest } = raw;
    const flags = extra.parse({ staple, expiresOn });
    const lines = linesFrom(rest).map((l) => ({ ...l, ...flags }));
    const added = await db.transaction((tx) => addToPantry(tx, lines));
    changed(req, "pantry");
    return reply.status(201).send({ added, pantry: await db.select().from(pantryItems).orderBy(asc(pantryItems.name)) });
  });

  app.patch("/api/pantry/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        quantity: z.number().min(0).max(100000).nullable().optional(),
        unit: z.string().trim().max(20).nullable().optional(),
        staple: z.boolean().optional(),
        expiresOn: isoDate.nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        aisle: z.enum(AISLE_IDS).optional(),
      })
      .strict()
      .parse(req.body);
    const [row] = await db
      .update(pantryItems)
      .set({ ...body, ...(body.name && !body.aisle ? { aisle: guessAisle(body.name) } : {}), updatedAt: new Date() })
      .where(eq(pantryItems.id, id))
      .returning();
    if (!row) throw notFound("Pantry item");
    if (body.aisle) await rememberAisle(db, row.name, body.aisle, "you");
    changed(req, "pantry");
    return row;
  });

  app.delete("/api/pantry/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(pantryItems).where(eq(pantryItems.id, id)).returning({ id: pantryItems.id });
    if (!gone.length) throw notFound("Pantry item");
    changed(req, "pantry");
    return reply.status(204).send();
  });

  // Used up: take several off at once
  app.post("/api/pantry/remove", async (req) => {
    const { ids } = idList.parse(req.body);
    const gone = ids.length ? await db.delete(pantryItems).where(inArray(pantryItems.id, ids)).returning({ id: pantryItems.id }) : [];
    changed(req, "pantry");
    return { removed: gone.length };
  });

  // ---------- cook with what I have ----------
  // Your recipes ranked by how much of them the pantry covers (staples count as there)
  app.get("/api/recipes/cookable", async (req) => {
    const { min } = z.object({ min: z.coerce.number().min(0).max(1).default(0.5) }).parse(req.query);
    const pantry = await db.select({ name: pantryItems.name }).from(pantryItems);
    if (!pantry.length) return [];
    const all = await db.select({ id: recipes.id, title: recipes.title, imageUrl: recipes.imageUrl, totalMinutes: recipes.totalMinutes, ingredients: recipes.ingredients }).from(recipes);
    return all
      .map((r) => {
        const needs = r.ingredients
          .filter((i) => !i.section)
          .map((i) => i.name ?? i.raw)
          .filter((n, k, all) => all.findIndex((m) => itemKey(m) === itemKey(n)) === k); // sugar for the crust and sugar for the filling: one thing
        if (!needs.length) return null;
        const missing = needs.filter((n) => !pantry.some((p) => sameItem(p.name, n)));
        return { id: r.id, title: r.title, imageUrl: r.imageUrl, totalMinutes: r.totalMinutes, have: needs.length - missing.length, of: needs.length, missing: missing.slice(0, 8) };
      })
      .filter((r): r is NonNullable<typeof r> => !!r && r.have / r.of >= min)
      .sort((a, b) => b.have / b.of - a.have / a.of || a.missing.length - b.missing.length)
      .slice(0, 40);
  });
}
