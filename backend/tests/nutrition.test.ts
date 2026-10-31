import { describe, expect, it } from "vitest";
import { ingredientsChanged } from "../src/lib/nutrition.js";

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
