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
  it("a recipe just typed in offers the AI check when AI Enhance is on", async () => {
    for (const hash of ["#/recipes/7?added=1"]) {
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

  it("a recipe just imported goes straight into the review (no offer to click)", async () => {
    window.location.hash = "#/recipes/7?imported=1";
    server(on);
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("dialog", { name: "Weeknight Chili" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
  });

  it("imported from a saved copy: the note says which archive, and when the copy was made", async () => {
    window.location.hash = "#/recipes/7?imported=1&copy=Wayback%20Machine&copied=2025-12-01";
    server({ ready: true, photos: false, enhance: false });
    render(<RecipeView id={7} />);
    const note = await screen.findByText(/from a saved copy/);
    expect(note).toHaveTextContent("The site blocked the import, so this came from a saved copy on the Wayback Machine (December 1, 2025). A saved copy can be older than the recipe on the site.");
  });

  it("imported with AI Enhance off: no review opens", async () => {
    window.location.hash = "#/recipes/7?imported=1";
    server({ ready: true, photos: false, enhance: false });
    render(<RecipeView id={7} />);
    await screen.findByRole("heading", { name: "Weeknight Chili", level: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no offer and no AI check button when AI Enhance is off", async () => {
    window.location.hash = "#/recipes/7?added=1";
    server({ ready: true, photos: false, enhance: false });
    render(<RecipeView id={7} />);
    await screen.findByRole("heading", { name: "Weeknight Chili" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Add to favorites/ })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Improve with AI" })).toBeNull();
  });

  it("no offer on a recipe that wasn't just added, but the AI check button is there", async () => {
    server(on);
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("button", { name: "Improve with AI" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
  });

  it("AI check opens the wizard; Check with AI does too", async () => {
    window.location.hash = "#/recipes/7?added=1";
    server(on);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "Check with AI" }));
    expect(await screen.findByRole("dialog", { name: "Weeknight Chili" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Instructions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check offer" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Skip" }));
    await u.click(screen.getByRole("button", { name: "Improve with AI" }));
    expect(await screen.findByRole("dialog", { name: "Weeknight Chili" })).toBeInTheDocument();
  });

  it("after applying AI changes there's no Undo (going back is in the version history)", async () => {
    const changed = recipeJson({ steps: [{ text: "Brown the beef well, about 8 minutes." }, { text: "Simmer for 30 minutes." }] });
    const s = server(on, recipeJson(), { "POST /api/recipes/7/enhance/apply": () => changed });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "Improve with AI" }));
    await u.click(await screen.findByRole("button", { name: "Next" }, { timeout: 3000 }));
    await u.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Weeknight Chili" })).toBeNull());
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent(/Brown the beef well, about 8 minutes/);
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
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

describe("recipe page header", () => {
  const header = async () => {
    const h = await screen.findByRole("region", { name: "Recipe" });
    await within(h).findByRole("button", { name: "Improve with AI" });
    return h;
  };

  it("on the category line: Start cooking, then Share and Delete as icons with hover text", async () => {
    server(on);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await header();
    const line = screen.getByText("Dinner").parentElement!;
    expect(within(line).getByRole("link", { name: /Start cooking/ })).toBeInTheDocument();
    expect(within(line).getByRole("button", { name: "Share" })).toHaveAttribute("title", "Share");
    expect(within(line).getByRole("button", { name: "Delete recipe" })).toHaveAttribute("title", "Delete recipe");
    await u.click(within(line).getByRole("button", { name: "Delete recipe" }));
    expect(await screen.findByRole("dialog", { name: "Delete this recipe?" })).toBeInTheDocument();
  });

  it("the buttons: Add to grocery list, Organize and Improve with AI; nothing else", async () => {
    server(on);
    render(<RecipeView id={7} />);
    const h = await header();
    const row = within(h).getByRole("group", { name: "Recipe actions" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Add to grocery list", "Organize", "Improve with AI"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit$/ })).toBeNull();
  });

  it("favorite and pin are icons by the name, with hover text", async () => {
    const s = server(on, recipeJson(), { "PUT /api/recipes/7/me": (body: any) => ({ favorite: false, pinned: false, rating: null, notes: null, ...body }) });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const h = await header();
    const fav = within(h).getByRole("button", { name: "Add to favorites" });
    expect(fav).toHaveAttribute("title", "Add to favorites");
    expect(fav).toHaveAttribute("aria-pressed", "false");
    expect(fav.textContent?.trim()).toBe("");
    await u.click(fav);
    await waitFor(() => expect(within(h).getByRole("button", { name: "Favorite" })).toHaveAttribute("aria-pressed", "true"));
    await u.click(within(h).getByRole("button", { name: "Pin to top" }));
    expect(s.writes().map((w) => w.body)).toEqual([{ favorite: true }, { pinned: true }]);
  });


  it("tags and collections show as pills under the buttons, in the header", async () => {
    server(on, recipeJson({ tags: ["beef", "spicy"], collections: [{ id: 2, name: "Quick Meals" }] }));
    render(<RecipeView id={7} />);
    const h = await header();
    const pills = within(h).getByRole("list", { name: "Tags and collections" });
    expect(within(pills).getAllByRole("link").map((a) => a.textContent)).toEqual(["Quick Meals", "#beef", "#spicy"]);
  });

  it("Ingredients: the pencil sits right after the heading; Add to grocery list isn't here", async () => {
    server(on);
    render(<RecipeView id={7} />);
    const ing = await screen.findByRole("region", { name: "Ingredients" });
    expect(within(ing).queryByRole("button", { name: /Add to grocery list/ })).toBeNull();
    const heading = within(ing).getByRole("heading", { name: "Ingredients" });
    expect(heading.nextElementSibling).toBe(within(ing).getByRole("button", { name: "Edit ingredients" }));
    expect(heading.className).not.toMatch(/mr-auto/);
  });

  it("every button that's only an icon has hover text", async () => {
    server(on, recipeJson({ tags: ["beef"], nutrition: { calories: 410, fat: 20, saturatedFat: 7, carbs: 30, fiber: 6, sugar: 14, protein: 33, sodium: 640, source: "ai", servings: 4 } }));
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await screen.findByRole("region", { name: "Recipe" });
    const check = () => {
      const bare = [...document.querySelectorAll("button, a[href]")].filter((b) => (b.textContent ?? "").replace(/\s/g, "").length <= 1 && !b.getAttribute("title"));
      expect(bare.map((b) => b.getAttribute("aria-label") ?? b.outerHTML.slice(0, 80))).toEqual([]);
    };
    check();
    await u.click(screen.getByRole("tab", { name: "Nutrition" }));
    check();
  });

  it("Organize: categories, collections and tags in one panel, saved together on Done", async () => {
    const s = server(on, recipeJson({ tags: ["beef"], categories: [{ id: 3, name: "Dinner" }], collections: [] }), {
      "GET /api/tags": () => [{ id: 1, name: "beef", count: 3 }, { id: 2, name: "weeknight", count: 5 }],
      "GET /api/categories": () => [{ id: 3, name: "Dinner", count: 4 }, { id: 4, name: "Soup", count: 1 }],
      "GET /api/collections": () => [{ id: 9, name: "Quick Meals", description: null, count: 2, images: [] }],
      "PATCH /api/recipes/7": (body: any) => recipeJson({ tags: body.tags, categories: [{ id: 3, name: "Dinner" }, { id: 4, name: "Soup" }], collections: [{ id: 9, name: "Quick Meals" }] }),
    });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const h = await header();
    await u.click(within(h).getByRole("button", { name: "Organize" }));
    const dlg = await screen.findByRole("dialog", { name: "Organize" });
    await u.click(await within(dlg).findByRole("checkbox", { name: "Soup" }));
    await u.click(within(dlg).getByRole("checkbox", { name: "Quick Meals" }));
    await u.click(within(dlg).getByRole("button", { name: "weeknight" }));
    await u.type(within(dlg).getByLabelText("New tag"), "spicy{Enter}");
    await u.click(within(dlg).getByRole("button", { name: "Remove beef" }));
    expect(s.writes()).toHaveLength(0); // nothing saved until Done
    await u.click(within(dlg).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(s.writes()).toHaveLength(1));
    expect(s.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/recipes/7", body: { categories: [3, 4], collections: [9], tags: ["weeknight", "spicy"] } });
    expect(s.writes()[0].body.version).toBeUndefined();
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Tags and collections" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Quick Meals", "#weeknight", "#spicy"]));
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
    await u.click(await screen.findByRole("button", { name: "Improve with AI" }));
    await u.click(await screen.findByRole("button", { name: "Skip" }, { timeout: 3000 }));
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
    const versionItems = () => within(screen.getByRole("list", { name: "Versions" })).getAllByRole("listitem");
    return { s, u, versionItems, item: (n: number) => versionItems().find((li) => li.textContent?.startsWith(`v${n}`))! };
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
    const { s, u, item, versionItems } = await history();
    await u.click(within(item(1)).getByRole("button", { name: "Delete" }));
    const ask = await screen.findByRole("dialog", { name: "Delete v1?" });
    await u.click(within(ask).getByRole("button", { name: "Delete v1" }));
    await waitFor(() => expect(versionItems()).toHaveLength(1));
    expect(s.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /api/recipes/7/versions/1"]);
  });
});

describe("scaled amounts go to the grocery list", () => {
  const lists = { "GET /api/grocery/lists": () => [{ id: 1, name: "Groceries", itemCount: 0 }], "POST /api/grocery/preview": () => ({ lines: [] }) };
  const previewBody = (s: { sent: { path: string; body: any }[] }) => s.sent.find((x) => x.path === "/api/grocery/preview")?.body;

  it("a recipe with a serving count: the servings you chose", async () => {
    const s = server(on, recipeJson({ servings: 4 }), lists);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "More servings" }));
    await u.click(await screen.findByRole("button", { name: "More servings" }));
    await u.click(screen.getByRole("button", { name: /Add to grocery list/ }));
    await waitFor(() => expect(previewBody(s)).toEqual({ recipes: [{ recipeId: 7, servings: 6 }] }));
  });

  it("a recipe without one: the size you chose (2×)", async () => {
    const s = server(on, recipeJson({ servings: null, yieldText: "24 cookies" }), lists);
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    await u.click(await screen.findByRole("button", { name: "Make more" }));
    await u.click(await screen.findByRole("button", { name: "Make more" }));
    await u.click(screen.getByRole("button", { name: /Add to grocery list/ }));
    await waitFor(() => expect(previewBody(s)).toEqual({ recipes: [{ recipeId: 7, scale: 2 }] }));
  });
});

describe("editing in place", () => {
  const editable = (recipe: Record<string, unknown> = {}, more: Record<string, any> = {}) =>
    server(on, recipeJson(recipe), { "PATCH /api/recipes/7": (body: any) => recipeJson({ ...recipe, ...patched(body) }), ...more });
  // what the server would send back after a PATCH (enough for these tests)
  const patched = (b: any) => ({
    ...(b.title !== undefined && { title: b.title }),
    ...(b.notes !== undefined && { notes: b.notes }),
    ...(b.servings !== undefined && { servings: b.servings }),
    ...(b.ingredients !== undefined && { ingredients: String(b.ingredients).split("\n").map((raw: string) => ({ raw })) }),
    ...(b.steps !== undefined && { steps: String(b.steps).split(/\n\n+/).map((text: string) => ({ text })) }),
  });
  const writes = (s: ReturnType<typeof server>) => s.writes().filter((w) => w.method === "PATCH");

  it("Ingredients: the pencil opens just that list; saving asks about the version", async () => {
    const s = editable();
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const ing = await screen.findByRole("region", { name: "Ingredients" });
    await u.click(within(ing).getByRole("button", { name: "Edit ingredients" }));
    const box = within(ing).getByRole("textbox", { name: "Ingredients" });
    expect(box).toHaveValue("1 lb ground beef\n2 tbsp chili powder");
    expect(screen.getByRole("region", { name: "Steps" })).not.toContainElement(screen.queryByRole("textbox", { name: "Steps" })); // the rest isn't being edited
    await u.type(box, "\n1 tsp salt");
    await u.click(within(ing).getByRole("button", { name: "Save" }));
    const ask = await screen.findByRole("dialog", { name: "Save your changes" });
    await u.click(within(ask).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(writes(s)).toHaveLength(1));
    expect(writes(s)[0].body).toEqual({ ingredients: "1 lb ground beef\n2 tbsp chili powder\n1 tsp salt", version: "new" });
    await waitFor(() => expect(within(ing).queryByRole("textbox")).toBeNull());
    expect(ing).toHaveTextContent("1 tsp salt");
  });

  it("Cancel puts it back and saves nothing", async () => {
    const s = editable();
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const ing = await screen.findByRole("region", { name: "Ingredients" });
    await u.click(within(ing).getByRole("button", { name: "Edit ingredients" }));
    await u.type(within(ing).getByRole("textbox", { name: "Ingredients" }), "\nnope");
    await u.click(within(ing).getByRole("button", { name: "Cancel" }));
    expect(within(ing).queryByRole("textbox")).toBeNull();
    expect(ing).not.toHaveTextContent("nope");
    expect(writes(s)).toHaveLength(0);
  });

  it("Steps: saved straight away when versioning is off", async () => {
    const s = editable({ versioning: false });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const steps = await screen.findByRole("region", { name: "Steps" });
    await u.click(within(steps).getByRole("button", { name: "Edit steps" }));
    const box = within(steps).getByRole("textbox", { name: "Steps" });
    expect(box).toHaveValue("Brown the beef.\n\nSimmer for 30 minutes.");
    await u.clear(box);
    await u.type(box, "Brown the beef well.");
    await u.click(within(steps).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(s)).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Save your changes" })).toBeNull();
    expect(writes(s)[0].body).toEqual({ steps: "Brown the beef well." });
    await waitFor(() => expect(steps).toHaveTextContent("Brown the beef well."));
  });

  it("Notes: there's always a place for them, with a pencil", async () => {
    const s = editable({ notes: null });
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const notes = await screen.findByRole("region", { name: "Recipe notes" });
    expect(notes).toHaveTextContent("No notes yet.");
    await u.click(within(notes).getByRole("button", { name: "Edit notes" }));
    await u.type(within(notes).getByRole("textbox", { name: "Notes" }), "Freezes well.");
    await u.click(within(notes).getByRole("button", { name: "Save" }));
    await u.click(await screen.findByRole("button", { name: "Save to current version" }));
    await waitFor(() => expect(writes(s)[0].body).toEqual({ notes: "Freezes well.", version: "current" }));
    await waitFor(() => expect(notes).toHaveTextContent("Freezes well."));
  });

  it("the details pencil by the name: name, description, servings, times and source, right there", async () => {
    const s = editable();
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const h = await screen.findByRole("region", { name: "Recipe" });
    await u.click(within(h).getByRole("button", { name: "Edit details" }));
    const form = within(h).getByRole("form", { name: "Recipe details" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Weeknight Chili");
    expect(within(form).getByLabelText("Servings")).toHaveValue("4");
    expect(within(form).getByLabelText("Prep time")).toHaveValue("10");
    await u.clear(within(form).getByLabelText("Name"));
    await u.type(within(form).getByLabelText("Name"), "Texas Chili");
    await u.clear(within(form).getByLabelText("Servings"));
    await u.type(within(form).getByLabelText("Servings"), "6");
    await u.click(within(form).getByRole("button", { name: "Save" }));
    await u.click(await screen.findByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(writes(s)).toHaveLength(1));
    expect(writes(s)[0].body).toMatchObject({ title: "Texas Chili", servings: 6, prepMinutes: 10, cookMinutes: 40, version: "new" });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Texas Chili"));
  });

  it("details: a servings or time it can't read says so, and saves nothing", async () => {
    const s = editable();
    const u = userEvent.setup();
    render(<RecipeView id={7} />);
    const h = await screen.findByRole("region", { name: "Recipe" });
    await u.click(within(h).getByRole("button", { name: "Edit details" }));
    const form = within(h).getByRole("form", { name: "Recipe details" });
    await u.clear(within(form).getByLabelText("Prep time"));
    await u.type(within(form).getByLabelText("Prep time"), "soon");
    await u.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText(/Use minutes or a time like 1 hr 15 min/)).toBeInTheDocument();
    expect(writes(s)).toHaveLength(0);
  });

  it("an old edit link opens the recipe with its details ready to edit", async () => {
    server(on);
    render(<RecipeView id={7} startEditing />);
    expect(await screen.findByRole("form", { name: "Recipe details" })).toBeInTheDocument();
  });
});

