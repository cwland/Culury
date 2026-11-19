import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import RecipesPage from "./RecipesPage";
import { fakeServer, recipeJson } from "../../test/fakeServer";

const summary = (id: number, title: string) => ({ id, title, imageUrl: null, totalMinutes: null, rating: null, favorite: false, pinned: false, tags: [], categories: [] });
const many = Array.from({ length: 40 }, (_, i) => summary(i + 1, `Recipe ${i + 1}`));

// jsdom doesn't scroll: keep a pretend scroll position that scrollTo sets and scroll events report
let y = 0;
const scrollTo = vi.fn((a: number | ScrollToOptions, b?: number) => {
  y = typeof a === "number" ? (b ?? 0) : (a.top ?? 0);
});
const scrollBy = (to: number) => {
  y = to;
  window.dispatchEvent(new Event("scroll"));
};
const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};

beforeEach(() => {
  y = 0;
  scrollTo.mockClear();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  fakeServer({
    "GET /api/tags": () => [],
    "GET /api/categories": () => [],
    "GET /api/collections": () => [],
    "GET /api/ai/status": () => ({ ready: false, photos: false, enhance: false }),
    "GET /api/recipes/7": () => recipeJson(),
    "GET /api/recipes": () => ({ total: 40, recipes: many }),
  });
});
afterEach(() => {
  window.location.hash = "";
});

describe("leaving a recipe brings the list back where you were", () => {
  it("the back arrow (or Back) returns to the same scroll position, with the recipes already there", async () => {
    window.location.hash = "#/recipes";
    render(<RecipesPage />);
    await screen.findAllByText("Recipe 40");
    scrollBy(1800);
    await go("#/recipes/7");
    await screen.findByRole("heading", { level: 1, name: "Weeknight Chili" });
    expect(y).toBe(0); // a recipe opens at its top
    scrollBy(300); // (reading the recipe)
    await go("#/recipes");
    expect(screen.getAllByText("Recipe 40").length).toBeGreaterThan(0); // no wait for the list to load again
    expect(y).toBe(1800);
  });

  it("a list with other filters, or arriving fresh, starts at the top", async () => {
    window.location.hash = "#/recipes";
    render(<RecipesPage />);
    await screen.findAllByText("Recipe 40");
    scrollBy(1800);
    await go("#/recipes/7");
    await screen.findByRole("heading", { level: 1, name: "Weeknight Chili" });
    await go("#/recipes?favorite=1");
    expect(y).toBe(0);
  });
});
