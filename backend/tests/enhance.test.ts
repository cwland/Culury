import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.ai.calls.length = 0;
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
const chili = async () =>
  (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: "1 lb chicken\n1 onion", steps: ["Cook the chicken."], categories: ["Dinner"], tags: ["spicy"] })).body;
const full = {
  steps: ["Cook the chicken until it reaches 165°F, about 6 minutes a side."],
  stepChanges: ["Added how long to cook the chicken and the safe temperature."],
  ingredients: ["1 lb chicken", "1 onion", "1 tsp salt"],
  ingredientChanges: ["Added salt: step 1 seasons the chicken."],
  nutrition: { calories: 320, fat: 9, saturatedFat: 2, carbs: 6, fiber: 1, sugar: 2, protein: 48, sodium: 600, note: "Assumed chicken breast." },
  nutritionChanges: ["Estimated from the ingredients."],
  categories: ["Dinner", "Soup"],
  tags: ["spicy", "chicken"],
  organizeChanges: ["Added Soup: it's a stew.", "Added chicken: the main ingredient."],
};

describe("asking AI to check a recipe", () => {
  it("suggests fixes for each section and changes nothing in the recipe", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply(full);
    const res = await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(res.status).toBe(200);
    const e = res.body;
    expect(e.steps).toMatchObject({ suggested: full.steps, changed: true });
    expect(e.steps.changes.length).toBeGreaterThan(0);
    expect(e.ingredients).toMatchObject({ suggested: full.ingredients, changed: true, changes: full.ingredientChanges });
    expect(e.nutrition.changed).toBe(true);
    expect(e.nutrition.suggested).toMatchObject({ calories: 320, protein: 48, source: "ai", servings: 4 });
    expect(e.organize).toMatchObject({ tags: ["spicy", "chicken"], changed: true });
    // what the AI was told
    const sent = t.ai.calls[0].body.messages[1].content as string;
    for (const bit of ["Chili", "1 lb chicken", "Cook the chicken.", "Dinner", "spicy", "Breakfast"]) expect(sent).toContain(bit);
    // nothing saved
    const after = (await t.api("GET", `/api/recipes/${r.id}`)).body;
    expect(after.steps).toEqual([{ text: "Cook the chicken." }]);
    expect(after.ingredients.map((i: any) => i.raw)).toEqual(["1 lb chicken", "1 onion"]);
    expect(after.nutrition).toBeNull();
    expect(after.tags).toEqual(["spicy"]);
  });

  it("a section the AI leaves out shows no changes", async () => {
    await aiOn();
    const r = await chili();
    const { nutrition: _n, nutritionChanges: _c, steps: _s, ...rest } = full;
    t.ai.respond = () => reply(rest);
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.nutrition).toEqual({ suggested: null, changes: [], changed: false });
    expect(e.steps).toEqual({ suggested: ["Cook the chicken."], changes: [], changed: false });
    expect(e.ingredients.changed).toBe(true);
  });

  it("the same lines, categories and tags count as no change", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply({ steps: [" Cook the chicken. "], ingredients: ["1 lb chicken", "1 onion"], categories: ["dinner"], tags: ["Spicy"] });
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect([e.steps.changed, e.ingredients.changed, e.organize.changed]).toEqual([false, false, false]);
    expect(e.organize.categories).toEqual(["Dinner"]);
    expect(e.organize.tags).toEqual(["spicy"]);
  });

  it("categories come from yours; a new one is marked", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply(full);
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.organize.categories).toEqual(["Dinner", "Soup"]);
    expect(e.organize.newCategories).toEqual(["Soup"]);
  });

  it("is refused when AI Enhance or AI is off, and for a recipe that isn't there", async () => {
    const r = await chili();
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await aiOn();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { aiEnhance: true, ai: false });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { ai: true });
    expect((await t.api("POST", `/api/recipes/99999/enhance`)).status).toBe(404);
    expect(t.ai.calls).toHaveLength(0);
  });
});

describe("applying and undoing AI changes", () => {
  const apply = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/enhance/apply`, body);
  const undo = (id: number) => t.api("POST", `/api/recipes/${id}/enhance/undo`);

  it("applies only the sections sent and keeps the original for undo", async () => {
    await aiOn();
    const r = await chili();
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.aiSnapshotAt).toBeNull();
    const res = await apply(r.id, { steps: ["# Cook", "Cook the chicken until it reaches 165°F."] });
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([{ text: "Cook", section: "Cook" }, { text: "Cook the chicken until it reaches 165°F." }]);
    expect(res.body.ingredients.map((i: any) => i.raw)).toEqual(["1 lb chicken", "1 onion"]);
    expect(res.body.tags).toEqual(["spicy"]);
    expect(res.body.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
    expect(res.body.aiSnapshotAt).toEqual(expect.any(String));
  });

  it("undo puts it back and removes the snapshot", async () => {
    await aiOn();
    const r = await chili();
    const nutrition = { calories: 320, fat: 9, saturatedFat: null, carbs: 6, fiber: 1, sugar: 2, protein: 48, sodium: 600, source: "ai", servings: 4, note: null };
    await apply(r.id, { steps: ["Cook it well."], ingredients: ["2 lb chicken"], nutrition, categories: ["Soup"], tags: ["stew"] });
    const back = await undo(r.id);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ steps: [{ text: "Cook the chicken." }], nutrition: null, tags: ["spicy"], aiSnapshotAt: null });
    expect(back.body.ingredients.map((i: any) => i.raw)).toEqual(["1 lb chicken", "1 onion"]);
    expect(back.body.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
    expect((await undo(r.id)).status).toBe(404);
  });

  it("new categories are created; a tag differing only in capitals reuses the existing one", async () => {
    await aiOn();
    await t.api("POST", "/api/recipes", { title: "Tacos", tags: ["chicken"] });
    const r = await chili();
    const tagsBefore = (await t.api("GET", "/api/tags")).body.length;
    const res = await apply(r.id, { categories: ["Dinner", "Soup"], tags: ["spicy", "Chicken"] });
    expect(res.body.categories.map((c: any) => c.name)).toEqual(["Dinner", "Soup"]);
    expect(res.body.tags).toEqual(["chicken", "spicy"]);
    expect((await t.api("GET", "/api/tags")).body.length).toBe(tagsBefore);
    expect((await t.api("GET", "/api/categories")).body.map((c: any) => c.name)).toContain("Soup");
  });

  it("a second apply replaces the snapshot: undo goes back one step", async () => {
    await aiOn();
    const r = await chili();
    await apply(r.id, { steps: ["First AI version."] });
    await apply(r.id, { steps: ["Second AI version."] });
    expect((await undo(r.id)).body.steps).toEqual([{ text: "First AI version." }]);
    expect((await undo(r.id)).status).toBe(404);
  });

  it("applying to a deleted recipe answers 404; applying is refused when AI Enhance is off", async () => {
    await aiOn();
    const r = await chili();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await apply(r.id, { steps: ["x"] })).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { aiEnhance: true });
    await t.api("DELETE", `/api/recipes/${r.id}`);
    const res = await apply(r.id, { steps: ["x"] });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Recipe/);
    expect((await undo(r.id)).status).toBe(404);
  });
});

describe("review fixes", () => {
  const apply = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/enhance/apply`, body);
  const undo = (id: number) => t.api("POST", `/api/recipes/${id}/enhance/undo`);

  it("undo puts back only the sections the AI changed, not later edits elsewhere", async () => {
    await aiOn();
    const r = await chili();
    await apply(r.id, { tags: ["chicken"] });
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 380 }); // typed in afterwards
    const back = (await undo(r.id)).body;
    expect(back.tags).toEqual(["spicy"]);
    expect(back.nutrition).toMatchObject({ calories: 380, source: "you" });
  });

  it("editing the recipe by hand after an AI change removes the undo, so it can't wipe your edit", async () => {
    await aiOn();
    const r = await chili();
    await apply(r.id, { tags: ["chicken"] });
    await t.api("PATCH", `/api/recipes/${r.id}`, { steps: ["Cook the chicken well."] });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.aiSnapshotAt).toBeNull();
    expect((await undo(r.id)).status).toBe(404);
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.steps).toEqual([{ text: "Cook the chicken well." }]);
  });

  it("an apply that fails keeps the earlier undo point and changes nothing", async () => {
    await aiOn();
    const r = await chili();
    await apply(r.id, { steps: ["First AI version."] });
    const bad = await apply(r.id, { steps: ["bad\u0000line"], tags: ["broken"] }); // the database refuses this text
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const now = (await t.api("GET", `/api/recipes/${r.id}`)).body;
    expect(now.steps).toEqual([{ text: "First AI version." }]);
    expect(now.tags).toEqual(["spicy"]);
    expect((await undo(r.id)).body.steps).toEqual([{ text: "Cook the chicken." }]);
  });

  it("an unreadable answer, or one with none of the parts, is a 502 with a log entry", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: "Sorry, I can't help with that." } }] } });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(502);
    t.ai.respond = () => reply({ error: "context too long" });
    const res = await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/didn't send any suggestions/);
    const logs = (await t.api("GET", "/api/logs?category=ai")).body.map((l: any) => l.event);
    expect(logs.some((e: string) => /couldn't be read/.test(e))).toBe(true);
    expect(logs.some((e: string) => /no suggestions/.test(e))).toBe(true);
  });
});
