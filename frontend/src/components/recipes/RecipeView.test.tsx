import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeView from "./RecipeView";
import { fakeServer, recipeJson } from "../../test/fakeServer";
import { forgetAiStatus } from "../../ai";

const OFFER = "Check this recipe with AI? It can fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags.";
const enhancement = {
  steps: { suggested: ["Brown the beef well, about 8 minutes.", "Simmer for 30 minutes."], changes: ["Added a time."], changed: true },
  ingredients: { suggested: ["1 lb ground beef", "2 tbsp chili powder"], changes: [], changed: false },
  nutrition: { suggested: null, changes: [], changed: false },
  organize: { categories: ["Dinner"], newCategories: [], tags: ["beef"], changes: [], changed: false },
};
const server = (status: object, recipe: object = recipeJson(), more: Record<string, any> = {}) =>
  fakeServer({ "GET /api/ai/status": () => status, "GET /api/recipes/7": () => recipe, "POST /api/recipes/7/enhance": () => enhancement, ...more });
const on = { ready: true, photos: false, enhance: true };

beforeEach(() => {
  forgetAiStatus();
  window.location.hash = "#/recipes/7";
});

describe("AI Enhance on the recipe page", () => {
  it("a newly added recipe offers the AI check when AI Enhance is on", async () => {
    for (const hash of ["#/recipes/7?added=1", "#/recipes/7?imported=1"]) {
      forgetAiStatus();
      window.location.hash = hash;
      server(on);
      const u = userEvent.setup();
      const { unmount } = render(<RecipeView id={7} />);
      const offer = await screen.findByRole("region", { name: "AI check offer" });
      expect(offer).toHaveTextContent(OFFER);
      await u.click(within(offer).getByRole("button", { name: "Not now" }));
      expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
      unmount();
    }
  });

  it("no offer and no AI check button when AI Enhance is off", async () => {
    window.location.hash = "#/recipes/7?added=1";
    server({ ready: true, photos: false, enhance: false });
    render(<RecipeView id={7} />);
    await screen.findByRole("heading", { name: "Weeknight Chili" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Add to favorites/ })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AI check" })).toBeNull();
  });

  it("no offer on a recipe that wasn't just added, but the AI check button is there", async () => {
    server(on);
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("button", { name: "AI check" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
  });

  it("AI check opens the wizard; Check with AI does too", async () => {
    window.location.hash = "#/recipes/7?added=1";
    server(on);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "Check with AI" }));
    expect(await screen.findByRole("dialog", { name: "AI check" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Instructions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Keep original" }));
    await u.click(screen.getByRole("button", { name: "AI check" }));
    expect(await screen.findByRole("dialog", { name: "AI check" })).toBeInTheDocument();
  });

  it("Undo AI changes shows after applying and puts the original back", async () => {
    const changed = recipeJson({ steps: [{ text: "Brown the beef well, about 8 minutes." }, { text: "Simmer for 30 minutes." }], aiSnapshotAt: "2026-10-31T10:00:00Z" });
    const s = server(on, recipeJson({ aiSnapshotAt: null }), {
      "POST /api/recipes/7/enhance/apply": () => changed,
      "POST /api/recipes/7/enhance/undo": () => recipeJson({ aiSnapshotAt: null }),
    });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("button", { name: "AI check" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo AI changes" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "AI check" }));
    await u.click(await screen.findByRole("button", { name: "Apply selected" }));
    const undo = await screen.findByRole("button", { name: "Undo AI changes" });
    expect(screen.queryByRole("dialog", { name: "AI check" })).toBeNull();
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent(/Brown the beef well, about 8 minutes/);
    await u.click(undo);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo AI changes" })).toBeNull());
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent("Brown the beef.");
    expect(screen.getByRole("region", { name: "Steps" })).not.toHaveTextContent("about 8 minutes");
    expect(s.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance", "/api/recipes/7/enhance/apply", "/api/recipes/7/enhance/undo"]);
  });
});
