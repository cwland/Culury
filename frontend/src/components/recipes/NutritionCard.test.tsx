import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NutritionCard } from "./NutritionCard";
import { fakeServer } from "../../test/fakeServer";
import { forgetAiStatus } from "../../ai";
import type { Nutrition } from "../../recipes";

const facts = (over: Partial<Nutrition> = {}): Nutrition => ({ calories: 410, fat: 20, saturatedFat: 7, carbs: 30, fiber: 6, sugar: 14, addedSugar: 12, protein: 33, sodium: 640, source: "ai", servings: 4, servingSize: "About 1½ cups (340 g)", note: null, ...over });
const card = (value: Nutrition | null, more: { updating?: boolean; onChange?: (n: Nutrition | null) => void } = {}) =>
  render(<NutritionCard recipeId={7} servings={4} value={value} updating={more.updating} onChange={more.onChange ?? (() => {})} />);

beforeEach(() => {
  forgetAiStatus();
});

describe("nutrition facts", () => {
  it("shows added sugars under total sugars, with its daily value", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts());
    const row = screen.getByRole("row", { name: /Includes 12 g added sugars/ });
    expect(within(row).getByText("24%")).toBeInTheDocument();
  });

  it("no added sugars known: that line isn't shown", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts({ addedSugar: null }));
    expect(screen.queryByText(/added sugars/)).toBeNull();
  });

  it("shows the serving size", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts());
    expect(screen.getByText("Serving size")).toBeInTheDocument();
    expect(screen.getByText("About 1½ cups (340 g)")).toBeInTheDocument();
  });

  it("says when nutrition is being worked out", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(null, { updating: true });
    expect(screen.getByRole("status")).toHaveTextContent("Updating nutrition…");
    expect(screen.queryByText("No nutrition facts yet.")).toBeNull();
  });

  it("numbers you typed in that are out of date: says so, and offers to estimate them", async () => {
    const server = fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "POST /api/recipes/7/nutrition": () => facts() });
    const onChange = vi.fn();
    const u = userEvent.setup();
    card(facts({ source: "you", outdated: true }), { onChange });
    expect(screen.getByText(/The ingredients changed since these numbers were entered/)).toBeInTheDocument();
    await u.click(await screen.findByRole("button", { name: "Estimate again" }));
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/nutrition"]);
    expect(onChange).toHaveBeenCalledWith(facts());
  });

  it("estimated numbers that are out of date say so too", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts({ outdated: true }));
    expect(screen.getByText(/The ingredients changed since these numbers were worked out/)).toBeInTheDocument();
  });

  it("typing them in includes added sugars and the serving size", async () => {
    const server = fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "PUT /api/recipes/7/nutrition": () => ({}) });
    const u = userEvent.setup();
    card(null);
    await u.click(screen.getByRole("button", { name: "Type it in" }));
    await u.type(screen.getByLabelText("Calories"), "300");
    await u.type(screen.getByLabelText("Added sugars (g)"), "9");
    await u.type(screen.getByLabelText("Serving size"), "1 bowl");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toMatchObject({ calories: 300, addedSugar: 9, servingSize: "1 bowl" });
  });
});
