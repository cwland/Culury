import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EnhanceWizard from "./EnhanceWizard";
import { fakeServer, ndjsonStream, recipeJson } from "../../test/fakeServer";
import type { Recipe } from "../../recipes";

const recipe = recipeJson() as unknown as Recipe;
const suggestion = (over: Record<string, unknown> = {}) => ({
  steps: { suggested: ["Brown the beef over medium-high heat, about 8 minutes.", "Simmer for 30 minutes."], changes: ["Added how long to brown the beef."], changed: true },
  ingredients: { suggested: ["1 lb ground beef", "2 tbsp chili powder", "1 tsp salt"], changes: ["Added salt."], changed: true },
  nutrition: { suggested: { calories: 410, fat: 22, saturatedFat: 8, carbs: 10, fiber: 3, sugar: 2, protein: 33, sodium: 640, source: "ai", servings: 4, note: null }, changes: ["Estimated from the ingredients."], changed: true },
  organize: { categories: ["Dinner", "Soup"], newCategories: ["Soup"], tags: ["chili"], changes: ["Added Soup.", "Swapped beef for chili."], changed: true },
  ...over,
});
const open = (routes: Record<string, any> = {}) => {
  const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion(), "POST /api/recipes/7/enhance/apply": () => recipeJson({ aiSnapshotAt: "2026-10-31T10:00:00Z" }), ...routes });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(<EnhanceWizard recipe={recipe} onClose={onClose} onApplied={onApplied} />);
  return { server, onApplied, onClose };
};

describe("AI Enhance wizard", () => {
  it("shows original and suggestion side by side for each section", async () => {
    open();
    const steps = await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 });
    expect(within(steps).getByRole("heading", { name: "Original" })).toBeInTheDocument();
    expect(within(steps).getByRole("heading", { name: "AI suggestion" })).toBeInTheDocument();
    expect(within(steps).getByText("Brown the beef.")).toBeInTheDocument();
    expect(within(steps).getByText("Brown the beef over medium-high heat, about 8 minutes.").closest("mark")).not.toBeNull();
    expect(within(steps).getAllByText("Simmer for 30 minutes.").every((el) => !el.closest("mark"))).toBe(true);
    expect(within(steps).getByText("Added how long to brown the beef.")).toBeInTheDocument();
    const ing = screen.getByRole("region", { name: "Ingredients" });
    expect(within(ing).getByText("1 tsp salt").closest("mark")).not.toBeNull();
    const nut = screen.getByRole("region", { name: "Nutrition" });
    expect(within(nut).getByText(/none/i)).toBeInTheDocument();
    expect(within(nut).getByText(/410/)).toBeInTheDocument();
    const org = screen.getByRole("region", { name: "Categories and tags" });
    expect(within(org).getByText("new")).toBeInTheDocument();
    expect(within(org).getByText("beef").closest("s")).not.toBeNull();
    expect(within(org).getByText("chili").closest("mark")).not.toBeNull();
    for (const name of ["Instructions", "Ingredients", "Nutrition", "Categories and tags"])
      expect(within(screen.getByRole("region", { name })).getByRole("checkbox", { name: "Use this" })).toBeChecked();
  });

  it("Apply selected sends only the ticked sections", async () => {
    const u = userEvent.setup();
    const { server, onApplied } = open();
    const nut = await screen.findByRole("region", { name: "Nutrition" }, { timeout: 3000 });
    await u.click(within(nut).getByRole("checkbox", { name: "Use this" }));
    await u.click(screen.getByRole("button", { name: "Apply selected" }));
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalled());
    const body = server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body;
    expect(Object.keys(body).sort()).toEqual(["categories", "ingredients", "steps", "tags"]);
    expect(body).toMatchObject({ categories: ["Dinner", "Soup"], tags: ["chili"], ingredients: ["1 lb ground beef", "2 tbsp chili powder", "1 tsp salt"] });
    expect(onApplied.mock.calls[0][0]).toMatchObject({ aiSnapshotAt: "2026-10-31T10:00:00Z" });
  });

  it("a section with no changes is unticked and says so", async () => {
    open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: ["Brown the beef.", "Simmer for 30 minutes."], changes: [], changed: false } }) });
    const steps = await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 });
    expect(within(steps).getByText("No changes")).toBeInTheDocument();
    expect(within(steps).queryByRole("checkbox", { name: "Use this" })).toBeNull();
  });

  it("Keep original closes without saving anything", async () => {
    const u = userEvent.setup();
    const { server, onClose } = open();
    await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Keep original" }));
    expect(onClose).toHaveBeenCalled();
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance"]);
  });

  it("when the AI fails it says why and Try again asks again", async () => {
    const u = userEvent.setup();
    let calls = 0;
    const { server } = open({
      "POST /api/recipes/7/enhance": () => (++calls === 1 ? { status: 502, json: { error: "OpenRouter's answer couldn't be read. Try again, or try another AI service." } } : suggestion()),
    });
    expect(await screen.findByText(/couldn't be read/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply selected" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 })).toBeInTheDocument();
    expect(server.writes().filter((w) => w.path === "/api/recipes/7/enhance")).toHaveLength(2);
  });

  it("a recipe deleted meanwhile: applying shows the message instead of crashing", async () => {
    const u = userEvent.setup();
    const { onApplied } = open({ "POST /api/recipes/7/enhance/apply": () => ({ status: 404, json: { error: "Recipe not found" } }) });
    await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Apply selected" }));
    expect(await screen.findByText("Recipe not found")).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("AI check progress and fuller instructions", () => {
  it("shows what the AI is doing as it happens, then the suggestions", async () => {
    const live = ndjsonStream();
    const { server } = open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Reading “Weeknight Chili”: 2 ingredients, 2 steps" });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    const log = await screen.findByRole("log", { name: "AI check progress" });
    await within(log).findByText("Asking Home AI (qwen3-vl:32b)…");
    expect(within(log).getByText("Reading “Weeknight Chili”: 2 ingredients, 2 steps")).toBeInTheDocument();
    expect(within(log).getByText("0:00")).toBeInTheDocument(); // the timer on the line still going
    expect(screen.getByText(/The AI was asked to/)).toBeInTheDocument();
    expect(server.sent.find((s) => s.path === "/api/recipes/7/enhance")!.headers.accept).toMatch(/application\/x-ndjson/);
    live.push({ type: "step", text: "Answer received from Home AI" });
    live.push({ type: "step", text: "Instructions: 1 step filled in or fixed" });
    live.push({ type: "result", enhancement: suggestion() });
    live.end();
    expect(await screen.findByRole("region", { name: "Instructions" })).toBeInTheDocument();
    // done: the list folds away behind a ">", and opens again on click
    expect(screen.queryByRole("log", { name: "AI check progress" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /What the AI did/ }));
    const done = within(screen.getByRole("log", { name: "AI check progress" }));
    expect(done.getByText("Instructions: 1 step filled in or fixed")).toBeInTheDocument();
    expect(done.getByText("Asked Home AI (qwen3-vl:32b)")).toBeInTheDocument(); // finished: past tense, with how long it took
    expect(done.getByText(/^took \d+:\d\d$/)).toBeInTheDocument();
    expect(screen.queryByText(/The AI was asked to/)).toBeNull();
  });

  it("says when brief steps were expanded, with each step's label in bold", async () => {
    const steps = ["# Prep and Season", "Pat dry: Pat the chops dry so they sear well.", "# Sear", "Brown: Sear 3–5 minutes per side."];
    open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: steps, changes: ["Expanded the steps."], changed: true, mode: "expanded" } }) });
    const sec = await screen.findByRole("region", { name: "Instructions" }, { timeout: 3000 });
    expect(within(sec).getByText("Expanded")).toBeInTheDocument();
    expect(within(sec).getByText("Prep and Season")).toBeInTheDocument();
    expect(within(sec).getByText("Pat dry:").tagName).toBe("STRONG");
  });

  it("a failure in the middle shows the reason; a refusal (AI Enhance off) has no Try again", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    live.push({ type: "error", status: 409, error: "AI Enhance is turned off. Turn it on in Settings › AI." });
    live.end();
    expect(await screen.findByText(/AI Enhance is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("a slow AI service", () => {
  it("shows the AI thinking, then writing with a word count, on the line still going", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    live.push({ type: "status", text: "Home AI is thinking…" });
    const log = await screen.findByRole("log", { name: "AI check progress" });
    expect(await within(log).findByText("Home AI is thinking…")).toBeInTheDocument();
    live.push({ type: "status", text: "Home AI is writing… 42 words" });
    expect(await within(log).findByText("Home AI is writing… 42 words")).toBeInTheDocument();
    expect(within(log).queryByText("Home AI is thinking…")).toBeNull(); // replaced, not added
  });

  it("Skip stops waiting for that service and asks the next one", async () => {
    const u = userEvent.setup();
    const live = ndjsonStream();
    const { server } = open({
      "POST /api/recipes/7/enhance": (_b: unknown, path: string) => (path.includes("skip=home") ? suggestion() : live.response),
    });
    live.push({ type: "step", text: "Reading “Weeknight Chili”: 2 ingredients, 2 steps" });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true, skip: { id: "home", name: "Home AI" } });
    await u.click(await screen.findByRole("button", { name: "Skip Home AI" }));
    expect(await screen.findByRole("region", { name: "Instructions" })).toBeInTheDocument();
    const calls = server.sent.filter((s) => s.path.startsWith("/api/recipes/7/enhance"));
    expect(calls.map((c) => c.path)).toEqual(["/api/recipes/7/enhance", "/api/recipes/7/enhance?skip=home"]);
    expect(calls[0].signal?.aborted).toBe(true); // the first request was stopped
    await u.click(screen.getByRole("button", { name: /What the AI did/ }));
    const log = within(screen.getByRole("log", { name: "AI check progress" }));
    expect(log.getByText("Skipped Home AI")).toBeInTheDocument();
    expect(log.getAllByText(/^Reading/)).toHaveLength(1);
  });

  it("no Skip button when there's no other service to ask", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    await screen.findByText("Asking Home AI (qwen3-vl:32b)…");
    expect(screen.queryByRole("button", { name: /^Skip/ })).toBeNull();
  });
});

describe("AI check nutrition", () => {
  it("shows added sugars and the serving size it suggests", async () => {
    const withMore = suggestion({ nutrition: { suggested: { calories: 410, fat: 22, saturatedFat: 8, carbs: 10, fiber: 3, sugar: 2, addedSugar: 1, protein: 33, sodium: 640, source: "ai", servings: 4, servingSize: "About 1 cup", note: null }, changes: [], changed: true } });
    open({ "POST /api/recipes/7/enhance": () => withMore });
    const nut = await screen.findByRole("region", { name: "Nutrition" }, { timeout: 3000 });
    expect(within(nut).getByText("Added sugars")).toBeInTheDocument();
    expect(within(nut).getByText("1 g")).toBeInTheDocument();
    expect(within(nut).getByText("Serving size")).toBeInTheDocument();
    expect(within(nut).getByText("About 1 cup")).toBeInTheDocument();
  });
});

