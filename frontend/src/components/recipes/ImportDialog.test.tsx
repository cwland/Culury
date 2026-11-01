import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAiStatus } from "../../ai";
import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("no recent imports list (they're in Settings › Logs)", () => {
  it("doesn't list or even load recent imports", async () => {
    const server = fakeServer({ "GET /api/imports": () => [{ id: 1, status: "done", source: "https://example.test/chili", result: { recipeId: 3, title: "Chili" }, error: null }], "GET /api/ai/status": () => ({ ready: true, photos: true, enhance: true }) });
    render(<ImportDialog onClose={() => {}} />);
    await screen.findByRole("button", { name: "Import" });
    expect(screen.queryByText("Recent imports")).toBeNull();
    expect(server.sent.filter((s) => s.path.startsWith("/api/imports"))).toHaveLength(0);
  });
});

describe("PDFs", () => {
  beforeEach(() => forgetAiStatus());
  const routes = (more: Record<string, any> = {}) => ({
    "GET /api/ai/status": () => ({ ready: true, photos: true }),
    "POST /api/recipes/import/file": () => ({ status: 202, json: job({ source: "chili.pdf", kind: "import-file" }) }),
    ...more,
  });

  it("the file tab takes a PDF too (one recipe or a whole cookbook)", async () => {
    fakeServer(routes());
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    expect(screen.getByLabelText("Recipe file")).toHaveAttribute("accept", expect.stringContaining(".pdf"));
    expect(screen.getAllByText(/PDF/).length).toBeGreaterThan(0);
  });

  it("the photo tab takes a PDF too, and sends it to be read as a file", async () => {
    const server = fakeServer(routes({ "GET /api/imports/31": () => job({ status: "running" }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(await screen.findByRole("tab", { name: "From a photo" }));
    expect(screen.getByLabelText("Recipe photos")).toHaveAttribute("accept", expect.stringContaining("application/pdf"));
    await u.upload(screen.getByLabelText("Recipe photos"), new File([new Uint8Array([37, 80, 68, 70])], "card.pdf", { type: "application/pdf" }));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/import/file"]));
  });

  it("a PDF with one recipe opens it, like a link would", async () => {
    window.location.hash = "#/recipes";
    fakeServer(routes({ "GET /api/imports/31": () => job({ status: "done", result: { format: "PDF", imported: 1, skipped: 0, recipeIds: [5], problems: [] } }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([37, 80, 68, 70])], "chili.pdf", { type: "application/pdf" }));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/5?imported=1"), { timeout: 4000 });
  });
});

describe("after importing many recipes", () => {
  beforeEach(() => forgetAiStatus());
  const done = (ai: object) =>
    fakeServer({
      "GET /api/ai/status": () => ai,
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", imported: 3, skipped: 0, recipeIds: [5, 6, 7], problems: [] } }),
      "POST /api/imports/31/improve": () => ({ status: 202, json: { ...job({}), id: 40, kind: "import-improve" } }),
    });
  const run = async () => {
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    return screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
  };

  it("offers to review them one by one with AI; the originals are kept", async () => {
    done({ ready: true, photos: false, enhance: true });
    const status = await run();
    expect(within(status).getByRole("link", { name: "Review one by one" })).toHaveAttribute("href", "#/recipes/review/31");
    expect(status).toHaveTextContent("Each recipe's original is kept as v1 in its Version history.");
  });

  it("Improve all automatically: says how many AI requests first, then starts and shows the progress", async () => {
    window.location.hash = "#/recipes";
    const server = done({ ready: true, photos: false, enhance: true });
    const improves = () => server.writes().filter((w) => w.path === "/api/imports/31/improve");
    const status = await run();
    const u = userEvent.setup();
    await u.click(within(status).getByRole("button", { name: "Improve all automatically" }));
    expect(status).toHaveTextContent("This asks your AI 3 times, once per recipe.");
    expect(improves()).toHaveLength(0); // not until Start
    await u.click(within(status).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/improving/40"));
    expect(improves()).toHaveLength(1);
  });

  it("with AI Enhance off there's nothing to offer", async () => {
    done({ ready: true, photos: false, enhance: false });
    const status = await run();
    expect(within(status).queryByRole("link", { name: "Review one by one" })).toBeNull();
  });
});

