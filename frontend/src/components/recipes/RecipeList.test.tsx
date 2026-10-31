import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeList from "./RecipeList";
import { fakeServer } from "../../test/fakeServer";

const summary = (id: number, title: string) => ({ id, title, imageUrl: null, totalMinutes: null, rating: null, favorite: false, pinned: false, tags: [], categories: [] });
const setup = () => {
  const server = fakeServer({
    "GET /api/tags": () => [
      { id: 1, name: "beef", count: 3 },
      { id: 2, name: "spicy", count: 2 },
    ],
    "GET /api/categories": () => [{ id: 3, name: "Dinner", count: 2 }],
    "GET /api/collections": () => [],
    "GET /api/recipes": (_b: unknown, path: string) => {
      const qs = new URLSearchParams(path.split("?")[1]);
      // "none" filters get their own count for the sidebar
      if (qs.get("category") === "none" && qs.get("limit") === "1") return { total: 4, recipes: [summary(9, "Toast")] };
      return { total: 1, recipes: [summary(1, "Chili")] };
    },
  });
  // what the list asked for last (ignoring the sidebar's count requests)
  const lastList = () => {
    const list = server.sent.filter((s) => s.path.startsWith("/api/recipes?") && new URLSearchParams(s.path.split("?")[1]).get("limit") !== "1");
    return new URLSearchParams(list[list.length - 1].path.split("?")[1]);
  };
  render(<RecipeList params={new URLSearchParams()} />);
  return { lastList };
};
const sidebar = () => within(screen.getByRole("complementary", { name: "Browse recipes" }));

describe("browsing the recipe list", () => {
  it("clicking a selected tag again turns it off", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    const beef = await sidebar().findByRole("button", { name: "beef" });
    await u.click(beef);
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["beef"]));
    await u.click(sidebar().getByRole("button", { name: "beef" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual([]));
    expect(sidebar().getByRole("button", { name: "beef" })).toHaveAttribute("aria-pressed", "false");
  });

  it("several tags can be on at once: recipes with all of them", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: "beef" }));
    await u.click(sidebar().getByRole("button", { name: "spicy" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["beef", "spicy"]));
    expect(sidebar().getByRole("button", { name: "beef" })).toHaveAttribute("aria-pressed", "true");
    expect(sidebar().getByRole("button", { name: "spicy" })).toHaveAttribute("aria-pressed", "true");
  });

  it("tags narrow the category you're in instead of replacing it", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: /Dinner/ }));
    await u.click(sidebar().getByRole("button", { name: "beef" }));
    await waitFor(() => expect([lastList().get("category"), lastList().getAll("tag")]).toEqual(["3", ["beef"]]));
  });

  it("clicking the selected category again goes back to all recipes", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: /Dinner/ }));
    await waitFor(() => expect(lastList().get("category")).toBe("3"));
    await u.click(sidebar().getByRole("button", { name: /Dinner/ }));
    await waitFor(() => expect(lastList().get("category")).toBeNull());
  });

  it("recipes with no category can be found, with how many there are", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    const none = await sidebar().findByRole("button", { name: /No category\s*4/ });
    await u.click(none);
    await waitFor(() => expect(lastList().get("category")).toBe("none"));
    expect(screen.getByRole("heading", { name: "No category" })).toBeInTheDocument();
  });

  it("recipes with no tags can be found", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: "No tags" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["none"]));
  });
});
