import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoveryPage from "./DiscoveryPage";
import { fakeServer } from "../../test/fakeServer";

// Discovery: recipes from the household's RSS feeds, as cards; your tags; one post as the feed sent it
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const feeds = [
  { id: 1, url: "https://kitchen.example.com/feed", title: "Test Kitchen", siteUrl: "https://kitchen.example.com/", iconUrl: null, lastFetchedAt: ago(1), lastError: null, items: 2 },
  { id: 2, url: "https://other.example.com/feed", title: "Other Eats", siteUrl: null, iconUrl: null, lastFetchedAt: ago(2), lastError: "That page couldn't be reached (404)", items: 1 },
];
const item = (id: number, title: string, more: object = {}) => ({ id, feedId: 1, feedTitle: "Test Kitchen", feedIcon: null, title, link: `https://kitchen.example.com/p${id}`, pubDate: ago(48), author: "Deb", categories: [], description: `${title}, the post.`, thumbnailUrl: `https://cdn.example.com/${id}.jpg`, matchedTags: [], recipeId: null, ...more });
const job = (over: object) => ({ id: 40, kind: "import-url", status: "queued", source: "https://kitchen.example.com/p5", result: null, error: null, createdAt: ago(0), ...over });
const page = (items: object[], more = false) => ({ items, more, next: more ? "1700000000000_9" : null, tags: [] });
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "GET /api/discovery/feeds": () => feeds,
    "GET /api/discovery/tags": () => ({ tags: ["keto"] }),
    "PUT /api/discovery/tags": (b: any) => ({ tags: b.tags }),
    "GET /api/discovery/items": (_: unknown, path: string) => (path.includes("match=tags") ? page([item(3, "Keto Pancakes", { matchedTags: ["keto"] })]) : path.includes("before=") ? page([item(9, "An older one")]) : page([item(5, "Crispy Air Fryer Chicken"), item(3, "Keto Pancakes", { matchedTags: ["keto"], thumbnailUrl: null })], true)),
    "POST /api/discovery/feeds": (b: any) => ({ status: 201, json: { ...feeds[0], id: 7, url: b.url, title: "New Feed", items: 4 } }),
    "DELETE /api/discovery/feeds/:id": () => ({ status: 204 }),
    "POST /api/discovery/refresh": () => ({ feeds: 2, added: 3, failed: 1 }),
    "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), feedSite: "https://kitchen.example.com/", contentHtml: '<p>Pat the thighs <strong>dry</strong>.</p><img src="https://cdn.example.com/in.jpg" alt="In the pan">' }),
    ...more,
  });
const cards = async () => within(await screen.findByRole("list", { name: "Recipes from your feeds" })).getAllByRole("listitem");
beforeEach(() => (window.location.hash = "#/discover"));

describe("the Discovery page", () => {
  it("a post already in your recipes says so on its card", async () => {
    routes({ "GET /api/discovery/items": () => page([item(5, "Crispy Air Fryer Chicken", { recipeId: 31 }), item(3, "Keto Pancakes")]) });
    render(<DiscoveryPage />);
    const [saved, notYet] = await cards();
    expect(within(saved).getByText("In your recipes")).toBeInTheDocument();
    expect(within(notYet).queryByText("In your recipes")).toBeNull();
  });

  it("shows posts from every feed as cards: picture, title, feed and when", async () => {
    routes();
    render(<DiscoveryPage />);
    const [first, second] = await cards();
    expect(first).toHaveTextContent(/Crispy Air Fryer Chicken.*Test Kitchen.*2 days ago/);
    expect(first.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/5.jpg");
    expect(second.querySelector("img")).toBeNull(); // no picture in the feed: the drawn one
    expect(within(first).getByRole("link")).toHaveAttribute("href", "#/discover/5");
  });

  it("one feed at a time", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.selectOptions(screen.getByRole("combobox", { name: "Feed" }), "Other Eats");
    await waitFor(() => expect(s.sent.some((r) => r.method === "GET" && r.path.startsWith("/api/discovery/items?") && r.path.includes("feed=2"))).toBe(true));
  });

  it("your tags: add and remove chips (saved for you)", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    const tags = await screen.findByRole("list", { name: "Your tags" });
    expect(within(tags).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["keto×"]);
    await u.type(screen.getByRole("textbox", { name: "Add a tag" }), "air fryer{Enter}");
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "PUT", path: "/api/discovery/tags", body: { tags: ["keto", "air fryer"] } }));
    await u.click(within(tags).getByRole("button", { name: "Remove keto" }));
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ tags: ["air fryer"] }));
  });

  it("pasting a list adds each tag", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByRole("list", { name: "Your tags" });
    await u.click(screen.getByRole("textbox", { name: "Add a tag" }));
    await u.paste("air fryer, chicken,");
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ tags: ["keto", "air fryer", "chicken"] }));
    expect(screen.getByRole("textbox", { name: "Add a tag" })).toHaveValue("");
  });

  it("Filter by tags: only matching posts, each with the tags it matched", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("radio", { name: "Filter by tags" }));
    await waitFor(() => expect(s.sent.some((r) => r.path.includes("match=tags"))).toBe(true));
    const [only] = await cards();
    expect(within(only).getByText("keto")).toBeInTheDocument();
    await waitFor(async () => expect(await cards()).toHaveLength(1));
  });

  it("Show more loads the next page", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(async () => expect(await cards()).toHaveLength(3));
    expect(s.sent.some((r) => r.path.includes("before=1700000000000_9"))).toBe(true);
  });

  it("Refresh checks the feeds now, and says what came in", async () => {
    routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("status")).toHaveTextContent("3 new posts · 1 feed couldn't be checked");
  });

  it("no feeds yet: says how to start, and Add a feed adds one", async () => {
    const s = routes({ "GET /api/discovery/feeds": () => [], "GET /api/discovery/items": () => page([]) });
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    expect(await screen.findByText(/Follow your favorite recipe sites/)).toBeInTheDocument();
    await u.click(screen.getAllByRole("button", { name: /Add a feed/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Your feeds" });
    await u.type(within(dialog).getByRole("textbox", { name: "Feed or website address" }), "https://newfeed.example.com");
    await u.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/discovery/feeds")?.body).toEqual({ url: "https://newfeed.example.com" }));
    expect(await within(dialog).findByText(/Added “New Feed”: 4 posts/)).toBeInTheDocument();
  });

  it("Your feeds lists each, says when one failed, and removes one", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Feeds" }));
    const dialog = await screen.findByRole("dialog", { name: "Your feeds" });
    const rows = within(within(dialog).getByRole("list", { name: "Feeds" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/Test Kitchen.*2 posts/);
    expect(rows[1]).toHaveTextContent(/Other Eats.*couldn't be reached \(404\)/);
    await u.click(within(rows[1]).getByRole("button", { name: "Remove Other Eats" }));
    await u.click(within(rows[1]).getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/discovery/feeds/2" }));
  });
});

describe("one post", () => {
  it("as the feed sent it: picture, title, author, feed, date, its text, and Open original site", async () => {
    routes();
    window.location.hash = "#/discover/5";
    render(<DiscoveryPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Crispy Air Fryer Chicken" })).toBeInTheDocument();
    expect(screen.getByText(/Deb · Test Kitchen · 2 days ago/)).toBeInTheDocument();
    const post = screen.getByRole("article", { name: "The post" });
    expect(within(post).getByText("dry").tagName).toBe("STRONG");
    expect(within(post).getByRole("img", { name: "In the pan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open original site/ })).toHaveAttribute("href", "https://kitchen.example.com/p5");
    expect(screen.getByRole("link", { name: /Open original site/ })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /Discover/ })).toHaveAttribute("href", "#/discover");
  });

  describe("Import Recipe", () => {
    const openPost = (more: Record<string, any>, post: object = {}) => {
      const s = routes({ "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), contentHtml: "<p>Hi</p>", ...post }), ...more });
      window.location.hash = "#/discover/5";
      render(<DiscoveryPage />);
      return s;
    };

    it("imports it, then says so with a link to the new recipe", async () => {
      let polls = 0;
      const s = openPost({
        "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }),
        "GET /api/imports/:id": () => (++polls > 1 ? job({ status: "done", result: { recipeId: 31, title: "Crispy Air Fryer Chicken" } }) : job({ status: "running" })),
      });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      expect(await screen.findByText(/Importing/)).toBeInTheDocument();
      const done = await screen.findByRole("status", {}, { timeout: 4000 });
      await waitFor(() => expect(done).toHaveTextContent("Imported “Crispy Air Fryer Chicken” into your recipes"), { timeout: 4000 });
      expect(within(done).getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/31?imported=1");
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
      expect(s.writes().map((w) => w.path)).toEqual(["/api/discovery/items/5/import"]);
    });

    it("read from the feed's copy: says so", async () => {
      openPost({ "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "done", result: { recipeId: 31, title: "Crispy Air Fryer Chicken", fromFeed: true } }) });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/The site kept Culury out, so it was read from the feed's copy/), { timeout: 4000 });
    });

    it("already in your recipes: says so, with the link", async () => {
      openPost({ "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "done", result: { duplicateOf: 8, title: "Crispy Air Fryer Chicken" } }) });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Already in your recipes"), { timeout: 4000 });
      expect(screen.getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/8");
    });

    it("it couldn't be imported: says why, and can be tried again", async () => {
      openPost({ "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "failed", error: "That page couldn't be reached (404). The feed's copy of the post didn't have the recipe either." }) });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(/feed's copy of the post didn't have the recipe either/);
      expect(screen.getByRole("button", { name: "Import Recipe" })).toBeEnabled();
    });

    it("a post already in your recipes: In your recipes, with the link, instead of Import", async () => {
      openPost({}, { recipeId: 31 });
      expect(await screen.findByText("In your recipes")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/31");
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
    });

    it("a post without a link can't be imported", async () => {
      openPost({}, { link: null });
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
    });
  });
});
