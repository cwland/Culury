import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookMode from "./CookMode";
import { fakeServer, recipeJson } from "../../test/fakeServer";

const chili = recipeJson({
  steps: [{ text: "Brown the ground beef." }, { section: "Simmer", text: "Simmer" }, { text: "Stir in the chili powder." }, { text: "Simmer for 30 minutes." }],
});
const open = async () => {
  fakeServer({ "GET /api/recipes/7": () => chili, "GET /api/recipes/7/me": () => ({}) });
  const view = render(<CookMode id={7} />);
  await screen.findByText(/Step 1 of 3/);
  return view;
};

describe("Cook Mode", () => {
  it("walks the steps with Next and Back, and Done shows the finish", async () => {
    const u = userEvent.setup();
    await open();
    expect(screen.getByText("Brown the ground beef.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 2 of 3/)).toHaveTextContent("Simmer"); // the heading labels the step
    await u.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    await u.click(screen.getByRole("button", { name: /Next/ }));
    await u.click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.getByText("All done. Enjoy!")).toBeInTheDocument();
  });

  it("arrow keys move between steps and Escape leaves", async () => {
    const u = userEvent.setup();
    await open();
    await u.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
    await u.keyboard("{ArrowLeft}");
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    await u.keyboard("{Escape}");
    expect(window.location.hash).toBe("#/recipes/7");
  });

  it("closing and reopening mid-cook picks up at the same step", async () => {
    const u = userEvent.setup();
    const first = await open();
    await u.keyboard("{ArrowRight}");
    first.unmount();
    await open().catch(() => {});
    expect(await screen.findByText(/Step 2 of 3/)).toBeInTheDocument();
  });

  it("cooking it again after finishing starts at step 1, not on the finish screen", async () => {
    const u = userEvent.setup();
    const first = await open();
    await u.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByText("All done. Enjoy!")).toBeInTheDocument();
    first.unmount(); // left with the X, not "Back to the recipe"
    fakeServer({ "GET /api/recipes/7": () => chili });
    render(<CookMode id={7} />);
    expect(await screen.findByText(/Step 1 of 3/)).toBeInTheDocument();
  });

  it("Start over unticks the ingredients you ticked", async () => {
    const u = userEvent.setup();
    await open();
    const beef = screen.getAllByRole("button", { name: /ground beef/ })[0];
    await u.click(beef);
    expect(beef).toHaveAttribute("aria-pressed", "true");
    await u.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await u.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /ground beef/ })[0]).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("fresh herbs in Cook Mode", () => {
  it("the checklist shows the dried amount too", async () => {
    fakeServer({ "GET /api/recipes/7": () => recipeJson({ ingredients: [{ raw: "3 sprigs fresh thyme", quantity: 3, quantityMax: null, unit: "sprig", name: "fresh thyme", note: null }] }), "GET /api/recipes/7/me": () => ({}) });
    render(<CookMode id={7} />);
    expect(await screen.findByRole("list", { name: "Ingredients checklist" })).toHaveTextContent("(about ¾ tsp dried)");
  });
});
