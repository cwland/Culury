import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeView from "./RecipeView";
import { fakeServer, recipeJson } from "../../test/fakeServer";
import { forgetAiStatus } from "../../ai";
import { setToken } from "../../api";

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

  it("Undo AI changes is in the More menu after applying, and puts the original back", async () => {
    const changed = recipeJson({ steps: [{ text: "Brown the beef well, about 8 minutes." }, { text: "Simmer for 30 minutes." }], aiSnapshotAt: "2026-10-31T10:00:00Z" });
    const s = server(on, recipeJson({ aiSnapshotAt: null }), {
      "POST /api/recipes/7/enhance/apply": () => changed,
      "POST /api/recipes/7/enhance/undo": () => recipeJson({ aiSnapshotAt: null }),
    });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("button", { name: "AI check" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: "Undo AI changes" })).toBeNull(); // nothing to undo yet
    await u.click(screen.getByRole("button", { name: "More" }));
    await u.click(screen.getByRole("button", { name: "AI check" }));
    await u.click(await screen.findByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI check" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Undo AI changes" })).toBeNull(); // not on the button row
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent(/Brown the beef well, about 8 minutes/);
    await u.click(screen.getByRole("button", { name: "More" }));
    await u.click(await screen.findByRole("menuitem", { name: "Undo AI changes" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent("Brown the beef."));
    expect(screen.getByRole("region", { name: "Steps" })).not.toHaveTextContent("about 8 minutes");
    await u.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: "Undo AI changes" })).toBeNull();
    expect(s.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance", "/api/recipes/7/enhance/apply", "/api/recipes/7/enhance/undo"]);
  });
});

describe("expanded steps on the recipe page", () => {
  it("a step's short label shows in bold, and headings group the steps", async () => {
    server(on, recipeJson({ steps: [{ text: "Sear the Pork Chops", section: "Sear the Pork Chops" }, { text: "Brown: Sear 3–5 minutes per side until golden." }] }));
    render(<RecipeView id={7} />);
    const steps = await screen.findByRole("region", { name: "Steps" });
    expect(within(steps).getByText("Brown:").tagName).toBe("STRONG");
    expect(within(steps).getByText("Sear the Pork Chops")).toBeInTheDocument();
    expect(within(steps).getByRole("button", { name: /3–5 minutes/ })).toBeInTheDocument(); // the timer still works
  });
});

describe("recipe page buttons", () => {
  it("Start cooking sits on the category line; no Duplicate; Delete is under More", async () => {
    server(on);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await screen.findByRole("heading", { name: "Weeknight Chili" });
    expect(within(screen.getByText("Dinner").parentElement!).getByRole("link", { name: /Start cooking/ })).toBeInTheDocument(); // on the category line
    expect(screen.queryByRole("button", { name: /Duplicate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    await u.click(screen.getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Delete"]);
    await u.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Delete this recipe?" })).toBeInTheDocument();
  });
});

describe("Auto nutrition on the recipe page", () => {
  const skips = (server: { writes: () => { path: string }[] }) => server.writes().filter((w) => w.path === "/api/recipes/7/enhance/skip");

  it("Not now on the AI check offer lets nutrition be worked out", async () => {
    window.location.hash = "#/recipes/7?added=1";
    const s = server(on, recipeJson(), { "POST /api/recipes/7/enhance/skip": () => ({ status: 204 }) });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const offer = await screen.findByRole("region", { name: "AI check offer" });
    await u.click(within(offer).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(skips(s)).toHaveLength(1));
  });

  it("closing the AI check without applying anything lets nutrition be worked out too", async () => {
    const s = server(on, recipeJson(), { "POST /api/recipes/7/enhance/skip": () => ({ status: 204 }) });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "AI check" }));
    await u.click(await screen.findByRole("button", { name: "Keep original" }));
    await waitFor(() => expect(skips(s)).toHaveLength(1));
  });

  it("while nutrition is being worked out it says so, and shows it as soon as it's done", async () => {
    setToken("t");
    let done = false;
    let send: (s: string) => void = () => {};
    const stream = new ReadableStream({ start: (c) => void (send = (s) => c.enqueue(new TextEncoder().encode(s))) });
    server(on, recipeJson(), {
      "GET /api/recipes/7": () => recipeJson(done ? { nutrition: { calories: 410, fat: 20, saturatedFat: 7, carbs: 30, fiber: 6, sugar: 14, addedSugar: 12, protein: 33, sodium: 640, source: "ai", servings: 4 }, nutritionUpdating: false } : { nutritionUpdating: true }),
      "GET /api/events": () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    try {
      const { unmount } = render(<RecipeView id={7} />);
      const panel = await screen.findByRole("region", { name: "Nutrition" });
      expect(within(panel).getByRole("status")).toHaveTextContent("Updating nutrition…");
      done = true;
      send(`data: ${JSON.stringify({ topic: "recipes", id: 7, by: null })}\n\n`);
      await waitFor(() => expect(within(panel).getByText("410")).toBeInTheDocument());
      unmount();
    } finally {
      setToken(null);
    }
  });
});

