import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WipeRecipes } from "./WipeRecipes";
import { fakeServer } from "../test/fakeServer";

describe("Wipe all recipes (Settings › Data)", () => {
  it("says what goes and what stays; the button only works once DELETE is typed", async () => {
    const server = fakeServer({ "POST /api/wipe/recipes": () => ({ recipes: 42, backup: "culury-2026-10-31-180000-before-wipe.tar.gz" }) });
    const u = userEvent.setup();
    render(<WipeRecipes />);
    const card = screen.getByRole("region", { name: "Wipe all recipes" });
    expect(card).toHaveTextContent(/versions, ratings, notes, photos/);
    expect(card).toHaveTextContent(/tags and collections/);
    expect(card).toHaveTextContent(/categories, grocery list, pantry and settings stay/);
    const go = within(card).getByRole("button", { name: "Wipe all recipes" });
    expect(go).toBeDisabled();
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "delete");
    expect(go).toBeDisabled(); // it has to be DELETE
    await u.clear(within(card).getByLabelText("Type DELETE to confirm"));
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "DELETE");
    await u.click(go);
    await waitFor(() => expect(server.writes()[0]).toMatchObject({ path: "/api/wipe/recipes", body: { confirm: "DELETE" } }));
    expect(await within(card).findByRole("status")).toHaveTextContent("Wiped 42 recipes. A backup was made first (culury-2026-10-31-180000-before-wipe.tar.gz): restore it above to bring them back.");
    expect(within(card).getByLabelText("Type DELETE to confirm")).toHaveValue("");
  });

  it("shows the server's message when it fails", async () => {
    fakeServer({ "POST /api/wipe/recipes": () => ({ status: 500, json: { error: "Couldn't make the backup" } }) });
    const u = userEvent.setup();
    render(<WipeRecipes />);
    const card = screen.getByRole("region", { name: "Wipe all recipes" });
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "DELETE");
    await u.click(within(card).getByRole("button", { name: "Wipe all recipes" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn't make the backup");
  });
});
