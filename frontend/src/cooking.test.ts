import { describe, expect, it } from "vitest";
import { convert, convertTemperatures, findTimers, formatAmount, ingredientLine, recipeUnits, scale, stepUses } from "./cooking";
import type { Ingredient } from "./recipes";

const ing = (quantity: number | null, unit: string | null, name: string, extra: Partial<Ingredient> = {}): Ingredient => ({ raw: `${quantity ?? ""} ${unit ?? ""} ${name}`.trim(), quantity, unit, name, ...extra });
const amount = (i: Ingredient, factor: number, units: "original" | "metric" | "us") => formatAmount(convert(scale(i, factor), units));

describe("scaling", () => {
  it("multiplies amounts and keeps kitchen fractions", () => {
    expect(amount(ing(1.5, "cup", "flour"), 2, "original")).toBe("3 cups");
    expect(amount(ing(1, "cup", "flour"), 0.5, "original")).toBe("½ cup");
    expect(amount(ing(2, "clove", "garlic", { quantityMax: 3 }), 2, "original")).toBe("4–6 cloves");
    expect(amount(ing(3, null, "eggs"), 1.5, "original")).toBe("4½");
  });
  it("leaves lines without amounts as written", () => {
    expect(ingredientLine({ raw: "Salt to taste", name: "Salt to taste", quantity: null, unit: null }, 2, "metric")).toMatchObject({ plain: true, name: "Salt to taste" });
    expect(ingredientLine({ raw: "Sauce:", section: "Sauce" }, 2, "metric")).toMatchObject({ plain: true, name: "Sauce" });
  });
});

describe("units", () => {
  it("US to metric, rounded the way a scale or jug reads", () => {
    expect(amount(ing(1, "cup", "milk"), 1, "metric")).toBe("240 ml");
    expect(amount(ing(4, "cup", "stock"), 1, "metric")).toBe("950 ml");
    expect(amount(ing(5, "cup", "stock"), 1, "metric")).toBe("1.18 l");
    expect(amount(ing(8, "oz", "cheese"), 1, "metric")).toBe("225 g");
    expect(amount(ing(2, "lb", "beef"), 1, "metric")).toBe("905 g");
    expect(amount(ing(1, "tbsp", "oil"), 1, "metric")).toBe("1 tbsp"); // spoons are spoons everywhere
  });
  it("metric to US", () => {
    expect(amount(ing(500, "g", "pasta"), 1, "us")).toBe("1⅛ lb");
    expect(amount(ing(450, "g", "pasta"), 1, "us")).toBe("1 lb");
    expect(amount(ing(200, "g", "chocolate"), 1, "us")).toBe("7 oz");
    expect(amount(ing(250, "ml", "cream"), 1, "us")).toBe("1 cup");
    expect(amount(ing(30, "ml", "lemon juice"), 1, "us")).toBe("2 tbsp");
    expect(amount(ing(1.5, "l", "water"), 1, "us")).toBe("1⅝ qt");
  });
  it("scale first, then convert; counts never change", () => {
    expect(amount(ing(100, "g", "butter"), 2, "us")).toBe("7 oz");
    expect(amount(ing(2, "can", "tomatoes"), 1, "metric")).toBe("2 cans");
  });
  it("knows which way a recipe leans", () => {
    expect(recipeUnits([ing(500, "g", "pasta"), ing(200, "ml", "cream"), ing(1, "cup", "x")])).toBe("metric");
    expect(recipeUnits([ing(1, "cup", "flour")])).toBe("us");
    expect(recipeUnits([ing(3, null, "eggs")])).toBeNull();
  });
});

describe("temperatures", () => {
  it("shows the other scale", () => {
    expect(convertTemperatures("Heat the oven to 350°F.", "metric")).toBe("Heat the oven to 175°C.");
    expect(convertTemperatures("Bake at 200 C for 20 minutes", "us")).toBe("Bake at 390°F for 20 minutes");
    expect(convertTemperatures("Bake at 400 degrees F", "metric")).toBe("Bake at 205°C");
    expect(convertTemperatures("Heat to 350°F", "original")).toBe("Heat to 350°F");
    expect(convertTemperatures("Heat to 180°C", "metric")).toBe("Heat to 180°C");
    expect(convertTemperatures("Add 2 C of flour", "us")).toBe("Add 2 C of flour");
  });
});

describe("timers in steps", () => {
  const t = (s: string) => findTimers(s).map((x) => [s.slice(x.start, x.end), x.label, x.seconds]);
  it("finds times, ranges and combinations", () => {
    expect(t("Simmer for 15 minutes, stirring.")).toEqual([["15 minutes", "15 min", 900]]);
    expect(t("Bake 6 to 8 minutes.")).toEqual([["6 to 8 minutes", "6–8 min", 360]]);
    expect(t("Roast for 1 hour 30 minutes")).toEqual([["1 hour 30 minutes", "1 hr 30 min", 5400]]);
    expect(t("Rest 1½ hours")).toEqual([["1½ hours", "1 hr 30 min", 5400]]);
    expect(t("Chill for an hour and a half")).toEqual([["an hour and a half", "1 hr 30 min", 5400]]);
    expect(t("Microwave 30 seconds, then 10m more")).toEqual([["30 seconds", "30 sec", 30], ["10m", "10 min", 600]]);
    expect(t("Cook 2-3 hrs")).toEqual([["2-3 hrs", "2–3 hr", 7200]]);
    expect(t("Add a minute or two of resting, about five minutes")).toEqual([["a minute", "1 min", 60], ["five minutes", "5 min", 300]]);
  });
  it("ignores things that aren't times", () => {
    expect(findTimers("Add 2 cups and stir. Serves 4 people. Mix a m s.")).toEqual([]);
    expect(findTimers("Stir in 3 tbsp butter")).toEqual([]);
  });
});

describe("which ingredients a step uses", () => {
  it("matches the ingredient's main word", () => {
    const step = "Stir in the beans and crushed tomatoes, then drizzle with oil.";
    expect(stepUses(step, ing(1, "can", "kidney beans"))).toBe(true);
    expect(stepUses(step, ing(1, "can", "San Marzano tomatoes"))).toBe(true);
    expect(stepUses(step, ing(2, "tbsp", "olive oil"))).toBe(true);
    expect(stepUses(step, ing(1, "lb", "ground beef"))).toBe(false);
    expect(stepUses(step, { raw: "Sauce:", section: "Sauce" })).toBe(false);
  });
});
