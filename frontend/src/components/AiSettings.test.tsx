import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiSettings from "./AiSettings";
import { fakeServer } from "../test/fakeServer";

describe("AI services help", () => {
  it("the (i) next to AI services lists what a model needs, and models to try (home and paid)", async () => {
    fakeServer({ "GET /api/settings/ai": () => ({ settings: null }), "GET /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true }) });
    const u = userEvent.setup();
    render(<AiSettings />);
    const services = await screen.findByRole("region", { name: "AI services" });
    await u.click(within(services).getByRole("button", { name: "Which AI models work with Culury" }));
    const help = await screen.findByRole("dialog", { name: "Which AI models work" });
    // what it must support
    for (const need of [/JSON/, /pictures|photos/i, /thinking|reasoning/i, /context/i]) expect(within(help).getAllByText(need).length).toBeGreaterThan(0);
    // something to try at home, and something paid
    expect(within(help).getByText("qwen3-vl:8b")).toBeInTheDocument();
    expect(within(help).getByText("claude-haiku-5-5")).toBeInTheDocument();
  });
});

describe("AI Enhance switch", () => {
  it("AI Enhance switch saves right away", async () => {
    const server = fakeServer({
      "GET /api/settings/ai": () => ({ settings: null }),
      "GET /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true }),
      "PUT /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: false }),
    });
    const u = userEvent.setup();
    render(<AiSettings />);
    const card = await screen.findByRole("region", { name: "AI Enhance" });
    const sw = within(card).getByRole("switch", { name: "AI Enhance" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(server.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ aiEnhance: false });
  });
});
