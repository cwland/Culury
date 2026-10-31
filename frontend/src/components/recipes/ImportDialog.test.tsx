import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportDialog from "./ImportDialog";
import { fakeServer } from "../../test/fakeServer";

const job = (over: Record<string, unknown>) => ({ id: 31, kind: "import-file", status: "queued", source: "My Recipes.paprikarecipes", result: null, error: null, createdAt: "2026-10-31T14:00:00Z", ...over });

describe("importing a file from another app", () => {
  it("uploads the file, then says how many came in, how many were already there, and what couldn't be used", async () => {
    let polls = 0;
    const server = fakeServer({
      "GET /api/ai/status": () => ({ ready: false, photos: false }),
      "GET /api/imports": () => [],
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () =>
        ++polls < 2 ? job({ status: "running" }) : job({ status: "done", result: { format: "Paprika", imported: 41, skipped: 3, problems: [{ name: "Untitled.paprikarecipe", reason: "It has no name" }] } }),
    });
    const onClose = vi.fn();
    const u = userEvent.setup();
    render(<ImportDialog onClose={onClose} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    const file = new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes");
    await u.upload(screen.getByLabelText("Recipe file"), file);
    await u.click(screen.getByRole("button", { name: "Import" }));
    const done = await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
    expect(done).toHaveTextContent("Added 41 recipes from Paprika");
    expect(done).toHaveTextContent("3 were already in your recipes");
    expect(within(done).getByText(/Untitled\.paprikarecipe/)).toHaveTextContent("It has no name");
    const sent = server.writes().find((w) => w.path === "/api/recipes/import/file")!;
    expect((sent.body as FormData).get("file")).toBeInstanceOf(File);
    expect(onClose).not.toHaveBeenCalled(); // stays open to show the summary
  });
});
