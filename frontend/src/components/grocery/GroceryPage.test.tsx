import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroceryPage from "./GroceryPage";
import { SessionContext, type User } from "../../session";
import { fakeServer } from "../../test/fakeServer";

vi.mock("../../live", () => ({ useLive: () => {} }));

const user = { id: 1, username: "cory", displayName: "Cory", email: null, role: "owner" } as User;
const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, listId: 1, name, quantity: null, unit: null, note: null, aisle: "dairy", aisleBy: "words", checked: false, position: id, sources: [], ...over });
const lists = [{ id: 1, name: "Week of November 16", open: 3, done: 0 }];

function page() {
  return render(
    <SessionContext.Provider value={{ user, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
      <GroceryPage />
    </SessionContext.Provider>,
  );
}

describe("grocery list: edit mode", () => {
  const routes = (items = [item(1, "eggs"), item(2, "milk"), item(3, "bread")]) => ({
    "GET /api/grocery/lists": () => lists,
    "GET /api/grocery/this-week": () => ({ name: "Week of November 16", listId: 1 }),
    "GET /api/grocery/lists/:id/items": () => items,
    "POST /api/grocery/items/delete": (b: any) => ({ deleted: b.ids.length }),
    "PATCH /api/grocery/items/:id": () => ({}),
  });

  it("selects several items and deletes them in one call", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select eggs" }));
    await u.click(screen.getByRole("checkbox", { name: "Select milk" }));
    await u.click(screen.getByRole("button", { name: "Delete 2 items" }));
    expect(screen.getByText("Delete 2 items?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(s.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/grocery/items/delete", body: { ids: [1, 2] } })]));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /^Select / })).not.toBeInTheDocument());
  });

  it("Select all, and Delete is off until something is picked", async () => {
    fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    expect(screen.getByRole("button", { name: "Delete 0 items" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Delete 3 items" })).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "eggs" })).toBeInTheDocument();
  });

  it("tapping a row in edit mode selects it, it doesn't check it off", async () => {
    const s = fakeServer(routes([item(1, "eggs"), item(2, "milk", { checked: true })]));
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select milk" })); // in the cart: can go too
    expect(screen.getByRole("checkbox", { name: "Select milk" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument(); // no pencils while selecting
    expect(s.writes()).toEqual([]);
  });

  it("outside edit mode, tapping checks it off and the ⋯ still edits one item", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("checkbox", { name: "eggs" }));
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/grocery/items/1", body: { checked: true } }));
    await u.click(screen.getByRole("button", { name: "Edit milk" }));
    expect(screen.getByRole("dialog", { name: "Edit item" })).toBeInTheDocument();
  });

  it("the tab shows how many are left in brackets", async () => {
    fakeServer(routes());
    page();
    const tab = await screen.findByRole("button", { name: "Week of November 16 (3)" });
    expect(within(tab).getByText("(3)")).toHaveClass("font-bold");
  });
});
