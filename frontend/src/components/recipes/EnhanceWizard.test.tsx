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
  const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion(), "POST /api/recipes/7/enhance/apply": () => recipeJson({ title: "Applied" }), ...routes });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(<EnhanceWizard recipe={recipe} onClose={onClose} onApplied={onApplied} />);
  return { server, onApplied, onClose };
};

// The review goes one part at a time: this moves to a part by its name
const goTo = async (u: ReturnType<typeof userEvent.setup>, name: string) => {
  await screen.findByText(/^Improve with AI · Step/, undefined, { timeout: 3000 }); // (the suggestions are in)
  for (let i = 0; i < 6 && !screen.queryByRole("region", { name }); i++) await u.click(await screen.findByRole("button", { name: "Next" }, { timeout: 3000 }));
  return screen.getByRole("region", { name });
};

describe("Improve with AI, one part at a time", () => {
  it("the recipe's name is in the header the whole way, with which step it's on", async () => {
    const u = userEvent.setup();
    open();
    const dlg = await screen.findByRole("dialog", { name: "Weeknight Chili" });
    expect(await within(dlg).findByText("Improve with AI · Step 1 of 5", undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(within(dlg).getByRole("button", { name: "Next" }));
    expect(within(dlg).getByText("Improve with AI · Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Weeknight Chili" })).toBe(dlg);
  });

  it("ingredients first, then instructions, nutrition, categories and tags: one screen each", async () => {
    const u = userEvent.setup();
    open();
    const ing = await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    expect(screen.queryByRole("region", { name: "Instructions" })).toBeNull();
    expect(within(ing).getByRole("heading", { name: "Original" })).toBeInTheDocument();
    expect(within(ing).getByRole("heading", { name: "AI suggestion" })).toBeInTheDocument();
    expect(within(ing).getByText("1 tsp salt").closest("mark")).not.toBeNull();
    expect(within(ing).getByText("Added salt.")).toBeInTheDocument();
    expect(within(ing).getByRole("radio", { name: "Use the AI's version" })).toBeChecked();
    await u.click(screen.getByRole("button", { name: "Next" }));
    const steps = screen.getByRole("region", { name: "Instructions" });
    expect(within(steps).getByText("Brown the beef.")).toBeInTheDocument();
    expect(within(steps).getByText("Brown the beef over medium-high heat, about 8 minutes.").closest("mark")).not.toBeNull();
    await u.click(screen.getByRole("button", { name: "Next" }));
    const nut = screen.getByRole("region", { name: "Nutrition" });
    expect(within(nut).getByText(/none/i)).toBeInTheDocument();
    expect(within(nut).getByText(/410/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Next" }));
    const org = screen.getByRole("region", { name: "Categories and tags" });
    expect(within(org).getByText("new")).toBeInTheDocument();
    expect(within(org).getByText("beef").closest("s")).not.toBeNull();
    // Back goes back
    await u.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Nutrition" })).toBeInTheDocument();
  });

  it("the last screen sums up the choices; Save sends only the parts you kept the AI's version of", async () => {
    const u = userEvent.setup();
    const { server, onApplied } = open();
    const nut = await goTo(u, "Nutrition");
    await u.click(within(nut).getByRole("radio", { name: "Keep the original" }));
    const summary = await goTo(u, "Save");
    expect(within(summary).getByRole("list", { name: "Your choices" })).toHaveTextContent(/Ingredients.*AI's version.*Instructions.*AI's version.*Nutrition.*Original.*Categories and tags.*AI's version/);
    expect(summary).toHaveTextContent("The recipe as it is now stays in Version history.");
    await u.click(within(summary).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalled());
    const body = server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body;
    expect(Object.keys(body).sort()).toEqual(["categories", "ingredients", "steps", "tags"]);
    expect(body).toMatchObject({ categories: ["Dinner", "Soup"], tags: ["chili"], ingredients: ["1 lb ground beef", "2 tbsp chili powder", "1 tsp salt"] });
    expect(onApplied.mock.calls[0][0]).toMatchObject({ title: "Applied" });
  });

  it("keeping the original everywhere: nothing to save, and it says so", async () => {
    const u = userEvent.setup();
    const { server, onClose } = open();
    for (const name of ["Ingredients", "Instructions", "Nutrition", "Categories and tags"]) await u.click(within(await goTo(u, name)).getByRole("radio", { name: "Keep the original" }));
    const summary = await goTo(u, "Save");
    expect(within(summary).getByRole("button", { name: "Save" })).toBeDisabled();
    await u.click(within(summary).getByRole("button", { name: "Close without changes" }));
    expect(onClose).toHaveBeenCalled();
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance"]);
  });

  it("a part with no changes is skipped", async () => {
    const u = userEvent.setup();
    open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: ["Brown the beef.", "Simmer for 30 minutes."], changes: [], changed: false } }) });
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    expect(screen.getByText("Improve with AI · Step 1 of 4")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("region", { name: "Nutrition" })).toBeInTheDocument();
  });

  it("nothing to change at all: says so, with a Done", async () => {
    const u = userEvent.setup();
    const none = { suggested: null, changes: [], changed: false };
    const { onClose } = open({
      "POST /api/recipes/7/enhance": () => ({ steps: { ...none, suggested: [] }, ingredients: { ...none, suggested: [] }, nutrition: none, organize: { categories: [], newCategories: [], tags: [], changes: [], changed: false } }),
    });
    expect(await screen.findByText("The AI didn't find anything to change. The recipe looks good as it is.", undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Skip this recipe (any time) closes without saving anything", async () => {
    const u = userEvent.setup();
    const { server, onClose } = open();
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Skip" }));
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
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 })).toBeInTheDocument();
    expect(server.writes().filter((w) => w.path === "/api/recipes/7/enhance")).toHaveLength(2);
  });

  it("a recipe deleted meanwhile: saving shows the message instead of crashing", async () => {
    const u = userEvent.setup();
    const { onApplied } = open({ "POST /api/recipes/7/enhance/apply": () => ({ status: 404, json: { error: "Recipe not found" } }) });
    const summary = await goTo(u, "Save");
    await u.click(within(summary).getByRole("button", { name: "Save" }));
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
    expect(await screen.findByRole("region", { name: "Ingredients" })).toBeInTheDocument();
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
    const sec = await goTo(userEvent.setup(), "Instructions");
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
    expect(await screen.findByRole("region", { name: "Ingredients" })).toBeInTheDocument();
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
    const nut = await goTo(userEvent.setup(), "Nutrition");
    expect(within(nut).getByText("Added sugars")).toBeInTheDocument();
    expect(within(nut).getByText("1 g")).toBeInTheDocument();
    expect(within(nut).getByText("Serving size")).toBeInTheDocument();
    expect(within(nut).getByText("About 1 cup")).toBeInTheDocument();
  });
});

