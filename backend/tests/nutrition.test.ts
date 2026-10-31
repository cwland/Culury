import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ingredientsChanged, ingredientsUpdated } from "../src/lib/nutrition.js";
import { setupTestApp, type TestApp } from "./helpers.js";

const list = (...lines: string[]) => lines.map((raw) => ({ raw }));

describe("did the ingredients change (for nutrition)?", () => {
  it("the same lines are not a change", () => {
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1 lb chicken", "1 onion"))).toBe(false);
  });

  it("a new, removed or different line is a change", () => {
    expect(ingredientsChanged(list("1 lb chicken"), list("1 lb chicken", "1 tsp salt"))).toBe(true);
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1 lb chicken"))).toBe(true);
    expect(ingredientsChanged(list("1 lb chicken"), list("2 lb chicken"))).toBe(true);
  });

  it("order, spacing and capital letters don't count", () => {
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1  Onion ", "1 lb chicken"))).toBe(false);
  });

  it("headings don't count", () => {
    expect(ingredientsChanged([{ raw: "For the sauce", section: "For the sauce" }, { raw: "1 onion" }], list("1 onion"))).toBe(false);
  });

  it("the same line twice is a different amount", () => {
    expect(ingredientsChanged(list("1 egg"), list("1 egg", "1 egg"))).toBe(true);
  });
});

// ---------- keeping nutrition up to date (Auto nutrition) ----------

describe("when the ingredients change", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });

  const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  const estimate = { calories: 410, fat: 20, saturatedFat: 7, carbs: 18, fiber: 6, sugar: 5, addedSugar: 2, protein: 33, sodium: 640, note: "Assumed 80/20 beef." };
  const chili = async (nutrition?: object) => {
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef\n1 can beans" })).body;
    if (nutrition) await t.api("PUT", `/api/recipes/${r.id}/nutrition`, nutrition);
    return r.id as number;
  };
  const changed = async (id: number) => {
    await ingredientsUpdated(t.app, id);
    await t.app.jobs.drain();
    return (await t.api("GET", `/api/recipes/${id}`)).body.nutrition;
  };

  it("works nutrition out again with AI, and open copies of the app hear about it", async () => {
    await aiOn();
    const id = await chili();
    t.ai.respond = () => reply(estimate);
    const heard: unknown[] = [];
    const off = t.app.events.on((e) => heard.push(e));
    const n = await changed(id);
    off();
    expect(n).toMatchObject({ calories: 410, addedSugar: 2, source: "ai", servings: 6 });
    expect(n.outdated).toBeUndefined();
    expect(heard).toContainEqual({ topic: "recipes", id, by: null });
    const log = (await t.api("GET", "/api/logs?category=ai")).body.find((l: any) => l.source === "Auto nutrition");
    expect(log).toMatchObject({ level: "info", event: "Nutrition worked out for Chili" });
  });

  it("replaces numbers from the recipe's site", async () => {
    await aiOn();
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "site"}' where id = ${id}`);
    t.ai.respond = () => reply(estimate);
    expect(await changed(id)).toMatchObject({ calories: 410, source: "ai" });
  });

  it("never changes numbers you typed in: they're marked as out of date instead", async () => {
    await aiOn();
    const id = await chili({ calories: 380, protein: 30 });
    t.ai.calls.length = 0;
    const n = await changed(id);
    expect(n).toMatchObject({ calories: 380, protein: 30, source: "you", outdated: true });
    expect(t.ai.calls).toHaveLength(0);
    // typing them in again clears it
    await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 390 });
    expect((await t.api("GET", `/api/recipes/${id}`)).body.nutrition.outdated).toBeUndefined();
  });

  it("an estimate clears the out-of-date mark", async () => {
    await aiOn();
    const id = await chili({ calories: 380 });
    await changed(id);
    t.ai.respond = () => reply(estimate);
    const n = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body;
    expect(n).toMatchObject({ calories: 410, source: "ai" });
    expect((await t.api("GET", `/api/recipes/${id}`)).body.nutrition.outdated).toBeUndefined();
  });

  it("Auto nutrition off: nothing is worked out, and the numbers there are marked out of date", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "ai"}' where id = ${id}`);
    t.ai.calls.length = 0;
    expect(await changed(id)).toMatchObject({ calories: 300, source: "ai", outdated: true });
    expect(t.ai.calls).toHaveLength(0);
  });

  it("AI off: nothing is worked out, and no nutrition stays no nutrition", async () => {
    const id = await chili();
    expect(await changed(id)).toBeNull();
    expect(t.ai.calls).toHaveLength(0);
  });

  it("several changes in a row ask AI once", async () => {
    await aiOn();
    const id = await chili();
    t.ai.respond = () => reply(estimate);
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {}; // hold the jobs until all three changes are in
    try {
      await ingredientsUpdated(t.app, id);
      await ingredientsUpdated(t.app, id);
      await ingredientsUpdated(t.app, id);
    } finally {
      t.app.jobs.kick = realKick;
    }
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect(t.ai.calls).toHaveLength(1);
  });

  it("when AI fails, the old numbers stay and the problem is logged", async () => {
    await aiOn();
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "ai"}' where id = ${id}`);
    t.ai.respond = () => ({ status: 500, json: { error: "boom" } });
    expect(await changed(id)).toMatchObject({ calories: 300, source: "ai" });
    const log = (await t.api("GET", "/api/logs?category=ai")).body.find((l: any) => l.source === "Auto nutrition");
    expect(log).toMatchObject({ level: "error" });
    expect(log.event).toContain("Chili");
  });

  it("a recipe deleted before its turn is skipped quietly", async () => {
    await aiOn();
    const id = await chili();
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {};
    try {
      await ingredientsUpdated(t.app, id);
    } finally {
      t.app.jobs.kick = realKick;
    }
    await t.api("DELETE", `/api/recipes/${id}`);
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect(t.ai.calls).toHaveLength(0);
    const [job] = (await t.app.db.execute(sql`select status from jobs where kind = 'nutrition'`)).rows as { status: string }[];
    expect(job.status).toBe("done");
  });
});
