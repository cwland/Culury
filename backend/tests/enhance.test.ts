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
