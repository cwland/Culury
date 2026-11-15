import { beforeEach, describe, expect, it } from "vitest";
import { gridClass, loadView, saveView } from "./recipeView";

describe("recipe list view setting", () => {
  beforeEach(() => localStorage.clear());

  it("starts as cards, 4 across", () => {
    expect(loadView()).toEqual({ mode: "cards", across: 4 });
  });

  it("remembers what was picked", () => {
    saveView({ mode: "list", across: 6 });
    expect(loadView()).toEqual({ mode: "list", across: 6 });
  });

  it("ignores broken or out-of-range saved values", () => {
    localStorage.setItem("culury-recipe-view", "{not json");
    expect(loadView()).toEqual({ mode: "cards", across: 4 });
    localStorage.setItem("culury-recipe-view", JSON.stringify({ mode: "huh", across: 40 }));
    expect(loadView()).toEqual({ mode: "cards", across: 6 });
    localStorage.setItem("culury-recipe-view", JSON.stringify({ mode: "list", across: 1 }));
    expect(loadView()).toEqual({ mode: "list", across: 2 });
  });

  it("phones keep 2 across; the picked number shows on wider screens", () => {
    expect(gridClass(2)).toBe("grid-cols-2");
    expect(gridClass(4)).toContain("md:grid-cols-4");
    expect(gridClass(4).split(" ")[0]).toBe("grid-cols-2");
    expect(gridClass(6)).toContain("xl:grid-cols-6");
    expect(gridClass(6)).not.toMatch(/(^| )grid-cols-6/);
  });
});
