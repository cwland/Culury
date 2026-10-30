import { describe, expect, it } from "vitest";
import { formatQuantity, parseIngredient, parseIngredientLines } from "../src/lib/ingredients.js";

const p = (s: string) => {
  const { raw: _raw, ...rest } = parseIngredient(s);
  return rest;
};

describe("ingredient lines", () => {
  it("reads quantities, units, names and notes", () => {
    expect(p("1 1/2 cups flour, sifted")).toEqual({ quantity: 1.5, quantityMax: null, unit: "cup", name: "flour", note: "sifted" });
    expect(p("2-3 cloves garlic, minced")).toMatchObject({ quantity: 2, quantityMax: 3, unit: "clove", name: "garlic", note: "minced" });
    expect(p("½ tsp salt")).toMatchObject({ quantity: 0.5, unit: "tsp", name: "salt" });
    expect(p("1½ Tbsp olive oil")).toMatchObject({ quantity: 1.5, unit: "tbsp", name: "olive oil" });
    expect(p("2 T butter")).toMatchObject({ quantity: 2, unit: "tbsp", name: "butter" });
    expect(p("1 t vanilla")).toMatchObject({ quantity: 1, unit: "tsp", name: "vanilla" });
    expect(p("200g dark chocolate")).toMatchObject({ quantity: 200, unit: "g", name: "dark chocolate" });
    expect(p("1.5 lbs chicken thighs")).toMatchObject({ quantity: 1.5, unit: "lb", name: "chicken thighs" });
    expect(p("2 cups of milk")).toMatchObject({ quantity: 2, unit: "cup", name: "milk" });
    expect(p("8 fl oz cream")).toMatchObject({ quantity: 8, unit: "fl oz", name: "cream" });
    expect(p("1 to 2 tablespoons honey")).toMatchObject({ quantity: 1, quantityMax: 2, unit: "tbsp", name: "honey" });
  });

  it("keeps a can size and words in brackets as notes", () => {
    expect(p("1 (14 oz) can diced tomatoes")).toMatchObject({ quantity: 1, unit: "can", name: "diced tomatoes", note: "14 oz" });
    expect(p("1 cup butter (softened)")).toMatchObject({ quantity: 1, unit: "cup", name: "butter", note: "softened" });
  });

  it("no quantity, no unit: the name as written", () => {
    expect(p("Salt and pepper to taste")).toMatchObject({ quantity: null, unit: null, name: "Salt and pepper to taste" });
    expect(p("3 eggs")).toMatchObject({ quantity: 3, unit: null, name: "eggs" });
    expect(p("2 large onions, diced")).toMatchObject({ quantity: 2, unit: null, name: "large onions", note: "diced" });
    // a word that starts like a unit isn't one
    expect(p("2 carrots")).toMatchObject({ unit: null, name: "carrots" });
    expect(p("1 tomato")).toMatchObject({ unit: null, name: "tomato" });
  });

  it("headings and pasted bullets", () => {
    expect(parseIngredient("For the sauce:")).toEqual({ raw: "For the sauce:", section: "For the sauce" });
    expect(parseIngredient("## Topping")).toMatchObject({ section: "Topping" });
    expect(p("- 1 cup sugar")).toMatchObject({ quantity: 1, unit: "cup", name: "sugar" });
    expect(p("▢ 2 tsp cumin")).toMatchObject({ quantity: 2, unit: "tsp", name: "cumin" });
    expect(parseIngredientLines("1 cup rice\n\n  2 cups water  \n")).toHaveLength(2);
  });

  it("writes quantities back as kitchen fractions", () => {
    expect([1.5, 0.333, 2, 0.25, 2.667, 1.1, 0.999].map(formatQuantity)).toEqual(["1 1/2", "1/3", "2", "1/4", "2 2/3", "1.1", "1"]);
  });
});
