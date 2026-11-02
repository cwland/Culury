import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupWizard from "./SetupWizard";
import GettingStarted from "./GettingStarted";
import { fakeServer } from "../test/fakeServer";
import type { User } from "../session";

// The first sign-in: a few steps to set Culury up, then the Getting started tour
const owner: User = { id: 1, username: "cory", displayName: null, email: "cory@example.com", role: "owner" };
const member: User = { ...owner, id: 2, username: "sam", role: "member" };
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "PATCH /api/profile": (b: any) => ({ ...owner, ...b }),
    "POST /api/settings/email/test": () => ({ ok: true, message: "Sent a test email to cory@example.com." }),
    "PUT /api/settings/email": () => ({ ok: true }),
    "POST /api/settings/ai/test": () => ({ ok: true, message: "qwen3 answered correctly." }),
    "PUT /api/settings/ai": () => ({ settings: { services: [{ id: "s1" }] } }),
    "PUT /api/settings/features": (b: any) => ({ ai: true, aiEnhance: true, autoNutrition: true, ...b }),
    "GET /api/categories": () => [{ id: 1, name: "Breakfast", count: 0 }, { id: 2, name: "Dinner", count: 0 }],
    "DELETE /api/categories/:id": () => ({ status: 204 }),
    "POST /api/categories": (b: any) => ({ status: 201, json: { id: 9, name: b.name, count: 0 } }),
    "POST /api/profile/setup-done": () => ({ user: { ...owner, setupDone: true } }),
    ...more,
  });
const step = () => screen.getByRole("region", { name: /Step \d+ of \d+/ });
const next = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole("button", { name: "Continue" }));

describe("the setup wizard", () => {
  it("the owner's steps, in order", async () => {
    routes();
    render(<SetupWizard user={owner} onDone={() => {}} />);
    expect(screen.getByRole("list", { name: "Setup steps" })).toHaveTextContent(/About you.*Measurements.*Passkey.*Email.*AI.*AI preferences.*Categories and tags/);
    expect(step()).toHaveAccessibleName("Step 1 of 7: About you");
  });

  it("About you: the full name is needed to go on; it's saved", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(within(step()).getByLabelText("Username")).toHaveValue("cory");
    await u.type(within(step()).getByLabelText("Full name"), "Cory Landers");
    await next(u);
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ path: "/api/profile", body: { displayName: "Cory Landers", username: "cory", email: "cory@example.com" } }));
    expect(await screen.findByRole("region", { name: "Step 2 of 7: Measurements" })).toBeInTheDocument();
  });

  it("Measurements: As is, Metric or US", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={{ ...owner, displayName: "Cory" }} onDone={() => {}} start={1} />);
    await u.click(within(step()).getByRole("radio", { name: /Metric/ }));
    await next(u);
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ path: "/api/profile", body: { units: "metric" } }));
  });

  it("Passkey: (i) explains it; it can be skipped", async () => {
    routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={2} />);
    await u.click(within(step()).getByRole("button", { name: "What's a passkey?" }));
    expect(within(step()).getByText(/sign in with Touch ID, Face ID/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("region", { name: "Step 4 of 7: Email" })).toBeInTheDocument();
  });

  it("Email: once it's filled in, Continue waits for a test email that works; or skip it", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={3} />);
    await u.selectOptions(within(step()).getByLabelText("Provider"), "gmail");
    await u.type(within(step()).getByLabelText("Username"), "cory@gmail.com");
    await u.type(within(step()).getByLabelText("Password"), "app-password");
    await u.type(within(step()).getByLabelText("From address"), "cory@gmail.com");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await u.click(within(step()).getByRole("button", { name: "Send a test email" }));
    expect(await within(step()).findByText("Sent a test email to cory@example.com.")).toBeInTheDocument();
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/email" && w.method === "PUT")?.body).toMatchObject({ enabled: true, host: "smtp.gmail.com", port: 587, username: "cory@gmail.com", fromAddress: "cory@gmail.com" }));
    expect(await screen.findByRole("region", { name: "Step 5 of 7: AI" })).toBeInTheDocument();
  });

  it("AI: test the service, then its preferences; skipping AI skips its preferences too", async () => {
    const s = routes();
    const u = userEvent.setup();
    const { unmount } = render(<SetupWizard user={owner} onDone={() => {}} start={4} />);
    expect(within(step()).getByText(/highly recommended/i)).toBeInTheDocument();
    await u.type(within(step()).getByLabelText("Address"), "http://10.0.0.5:11434/v1");
    await u.type(within(step()).getByLabelText("Model"), "qwen3");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await u.click(within(step()).getByRole("button", { name: "Test connection" }));
    expect(await within(step()).findByText("qwen3 answered correctly.")).toBeInTheDocument();
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/ai")?.body).toMatchObject({ services: [{ provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen3" }] }));
    const prefs = await screen.findByRole("region", { name: "Step 6 of 7: AI preferences" });
    await u.click(within(prefs).getByRole("checkbox", { name: /Auto nutrition/ }));
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ aiEnhance: true, autoNutrition: false }));
    unmount();
    routes();
    render(<SetupWizard user={owner} onDone={() => {}} start={4} />);
    await u.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("region", { name: /Categories and tags/ })).toBeInTheDocument();
  });

  it("Categories and tags: the starting categories, to keep, remove or add to; Finish ends setup", async () => {
    const s = routes();
    const u = userEvent.setup();
    const onDone = vi.fn();
    render(<SetupWizard user={owner} onDone={onDone} start={6} />);
    const cats = await within(step()).findByRole("list", { name: "Categories" });
    expect(within(cats).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Breakfast×", "Dinner×"]);
    await u.click(within(cats).getByRole("button", { name: "Remove Breakfast" }));
    await u.type(within(step()).getByLabelText("New category"), "Brunch{Enter}");
    await u.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ setupDone: true })));
    expect(s.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /api/categories/1", "POST /api/categories", "POST /api/profile/setup-done"]);
  });

  it("a member gets the short version: about you, measurements, passkey", async () => {
    routes();
    render(<SetupWizard user={member} onDone={() => {}} />);
    expect(screen.getByRole("list", { name: "Setup steps" })).toHaveTextContent(/^About you.*Measurements.*Passkey$/);
    expect(screen.queryByText("Email")).toBeNull();
  });
});

describe("the Getting started tour", () => {
  it("a few screens about the main things, Next and Back, Done at the end", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<GettingStarted onClose={onClose} />);
    const tour = screen.getByRole("dialog", { name: "Getting started" });
    expect(tour).toHaveTextContent("Add your recipes");
    await u.click(within(tour).getByRole("button", { name: "Next" }));
    expect(tour).toHaveTextContent("Cook from a recipe");
    await u.click(within(tour).getByRole("button", { name: "Back" }));
    expect(tour).toHaveTextContent("Add your recipes");
    for (let i = 0; i < 4; i++) await u.click(within(tour).getByRole("button", { name: "Next" }));
    await u.click(within(tour).getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
