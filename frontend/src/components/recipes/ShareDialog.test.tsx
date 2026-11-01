import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareDialog from "./ShareDialog";
import { fakeServer } from "../../test/fakeServer";

const A = { path: "/share/rcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://recipes.test/share/rcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", on: true };
const B = { path: "/share/rcp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "https://recipes.test/share/rcp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", on: true };

describe("the recipe's public link (Share)", () => {
  it("shows the link, and copies it", async () => {
    fakeServer({ "GET /api/recipes/7/share-link": () => A });
    const u = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    expect(await within(box).findByRole("textbox", { name: "Public link" })).toHaveValue(A.url);
    await u.click(within(box).getByRole("button", { name: "Copy link" }));
    expect(write).toHaveBeenCalledWith(A.url);
    expect(await within(box).findByText("Copied")).toBeInTheDocument();
  });

  it("New link asks first, then replaces it (the old one stops working)", async () => {
    const server = fakeServer({ "GET /api/recipes/7/share-link": () => A, "POST /api/recipes/7/share-link/new": () => B });
    const u = userEvent.setup();
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    await within(box).findByDisplayValue(A.url);
    await u.click(within(box).getByRole("button", { name: "New link" }));
    expect(box).toHaveTextContent("The current link will stop working");
    expect(server.writes()).toHaveLength(0);
    await u.click(within(box).getByRole("button", { name: "Make a new link" }));
    await waitFor(() => expect(within(box).getByRole("textbox", { name: "Public link" })).toHaveValue(B.url));
  });

  it("with public links off, says so instead", async () => {
    fakeServer({ "GET /api/recipes/7/share-link": () => ({ ...A, on: false }) });
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    expect(await within(box).findByText(/Public share links are off/)).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});
