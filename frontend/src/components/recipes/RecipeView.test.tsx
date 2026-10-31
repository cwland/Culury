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

  it("after applying AI changes there's no Undo (going back is in the version history)", async () => {
    const changed = recipeJson({ steps: [{ text: "Brown the beef well, about 8 minutes." }, { text: "Simmer for 30 minutes." }] });
    const s = server(on, recipeJson(), { "POST /api/recipes/7/enhance/apply": () => changed });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "AI check" }));
    await u.click(await screen.findByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI check" })).toBeNull());
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent(/Brown the beef well, about 8 minutes/);
    await u.click(screen.getByRole("button", { name: "More" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Delete"]);
    expect(s.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance", "/api/recipes/7/enhance/apply"]);
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
      const u = userEvent.setup();
      const { unmount } = render(<RecipeView id={7} />);
      await u.click(await screen.findByRole("tab", { name: "Nutrition" }));
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

describe("recipe tabs", () => {
  const versions = [
    { number: 2, source: "edit", summary: "Changed ingredients and steps", active: true, createdAt: "2026-10-31T22:20:00.000Z", by: "Cory" },
    { number: 1, source: "import", summary: "Imported", active: false, createdAt: "2026-10-30T12:00:00.000Z", by: "Cory" },
  ];

  it("starts on the recipe; nutrition has its own tab", async () => {
    server(on, recipeJson({ nutrition: { calories: 410, fat: 20, saturatedFat: 7, carbs: 30, fiber: 6, sugar: 14, protein: 33, sodium: 640, source: "ai", servings: 4 } }));
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const tabs = await screen.findByRole("tablist", { name: "Recipe sections" });
    expect(within(tabs).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Active recipe", "Nutrition", "Version history"]);
    expect(within(tabs).getByRole("tab", { name: "Active recipe" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Ingredients" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Steps" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Nutrition" })).toBeNull();
    await u.click(within(tabs).getByRole("tab", { name: "Nutrition" }));
    expect(within(screen.getByRole("region", { name: "Nutrition" })).getByText("410")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ingredients" })).toBeNull();
  });

  it("the version history lists every version, newest first, with the active one marked", async () => {
    server(on, recipeJson(), { "GET /api/recipes/7/versions": () => versions });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("tab", { name: "Version history" }));
    const list = await screen.findByRole("list", { name: "Versions" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("v2");
    expect(items[0]).toHaveTextContent("Edit");
    expect(items[0]).toHaveTextContent("Changed ingredients and steps");
    expect(items[0]).toHaveTextContent("Active");
    expect(items[0]).toHaveTextContent("Cory");
    expect(items[1]).toHaveTextContent("v1");
    expect(items[1]).toHaveTextContent("Imported");
    expect(items[1]).not.toHaveTextContent("Active");
  });

  it("versioning off: no Version history tab", async () => {
    server(on, recipeJson({ versioning: false }));
    render(<RecipeView id={7} />);
    const tabs = await screen.findByRole("tablist", { name: "Recipe sections" });
    expect(within(tabs).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Active recipe", "Nutrition"]);
  });
});

describe("version history actions", () => {
  const versions = (active: number) => [
    { number: 2, source: "edit", summary: "Changed the title", active: active === 2, createdAt: "2026-10-31T22:20:00.000Z", by: "Cory" },
    { number: 1, source: "created", summary: "Added", active: active === 1, createdAt: "2026-10-30T12:00:00.000Z", by: "Cory" },
  ];
  const history = async (more: Record<string, any> = {}) => {
    let active = 2;
    let gone = false;
    const s = server(on, recipeJson({ title: "Texas Chili" }), {
      "GET /api/recipes/7/versions": () => versions(active).filter((v) => !(gone && v.number === 1)),
      "POST /api/recipes/7/versions/1/activate": () => ((active = 1), recipeJson({ title: "Weeknight Chili", updatedAt: "2026-10-31T23:00:00.000Z" })),
      "DELETE /api/recipes/7/versions/1": () => ((gone = true), { status: 204 }),
      ...more,
    });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("tab", { name: "Version history" }));
    await screen.findByRole("list", { name: "Versions" });
    return { s, u, item: (n: number) => screen.getAllByRole("listitem").find((li) => li.textContent?.startsWith(`v${n}`))! };
  };

  it("the active version has no Set active or Delete", async () => {
    const { item } = await history();
    expect(within(item(2)).queryByRole("button")).toBeNull();
    expect(within(item(1)).getByRole("button", { name: "Set active" })).toBeInTheDocument();
    expect(within(item(1)).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("Set active makes the recipe that version", async () => {
    const { s, u, item } = await history();
    await u.click(within(item(1)).getByRole("button", { name: "Set active" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Weeknight Chili"));
    await waitFor(() => expect(item(1)).toHaveTextContent("Active"));
    expect(s.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/recipes/7/versions/1/activate"]);
  });

  it("Delete asks first, then removes it", async () => {
    const { s, u, item } = await history();
    await u.click(within(item(1)).getByRole("button", { name: "Delete" }));
    const ask = await screen.findByRole("dialog", { name: "Delete v1?" });
    await u.click(within(ask).getByRole("button", { name: "Delete v1" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(s.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /api/recipes/7/versions/1"]);
  });
});

