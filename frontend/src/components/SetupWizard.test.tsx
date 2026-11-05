import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupWizard from "./SetupWizard";
import GettingStarted from "./GettingStarted";
import { fakeServer } from "../test/fakeServer";
import type { User } from "../session";

// The first sign-in: a wizard over the app, one short page per step (nothing to scroll). The owner:
// Welcome, Passkey, Choose an AI, Connect your AI, Backup AI, Fine-Tune AI, Email, Recipe & Meal
// Planning, Done. A member: Welcome, Passkey, Recipe & Meal Planning, Done. Skip Setup is always there.
const owner: User = { id: 1, username: "cory", displayName: null, email: "cory@example.com", role: "owner" };
const member: User = { ...owner, id: 2, username: "sam", displayName: "Sam Landers", role: "member" };
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "PATCH /api/profile": (b: any) => ({ ...owner, ...b }),
    "GET /api/auth/passkeys": () => [],
    "POST /api/settings/email/test": () => ({ ok: true, message: "Sent a test email to cory@example.com." }),
    "PUT /api/settings/email": () => ({ ok: true }),
    "POST /api/settings/ai/test": (b: any) => ({ ok: true, message: `${b.model} answered correctly.` }),
    "POST /api/settings/ai/models": () => ({ models: ["claude-haiku-5-5", "claude-sonnet-5-5"] }),
    "PUT /api/settings/ai": () => ({ settings: { services: [{ id: "s1" }] } }),
    "PUT /api/settings/features": (b: any) => ({ ai: true, aiEnhance: true, autoNutrition: true, savedCopies: true, discoveryRefresh: true, ...b }),
    "POST /api/profile/setup-done": () => ({ user: { ...owner, setupDone: true } }),
    ...more,
  });
const dialog = () => screen.getByRole("dialog", { name: "Set up Culury" });
const step = () => screen.getByRole("region", { name: /Step \d+ of \d+/ });
const next = (u: ReturnType<typeof userEvent.setup>) => u.click(within(dialog()).getByRole("button", { name: /^Next/ }));
const at = (n: number, title: string, of = 9) => screen.findByRole("region", { name: `Step ${n} of ${of}: ${title}` });
// steps (0-based) for start=
const S = { welcome: 0, passkey: 1, ai: 2, connect: 3, backup: 4, aiPrefs: 5, email: 6, prefs: 7, done: 8 };

describe("the setup wizard", () => {
  it("a modal over the app: nine short steps for the owner, progress, and Skip Setup", async () => {
    routes();
    render(<SetupWizard user={owner} onDone={() => {}} />);
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(step()).toHaveAccessibleName("Step 1 of 9: Welcome to Culury");
    expect(within(dialog()).getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute("aria-valuenow", "1");
    expect(within(dialog()).getByRole("button", { name: "Skip Setup" })).toBeInTheDocument();
  });

  it("Skip Setup ends setup straight away", async () => {
    const s = routes();
    const u = userEvent.setup();
    const onDone = vi.fn();
    render(<SetupWizard user={owner} onDone={onDone} start={S.ai} />);
    await u.click(within(dialog()).getByRole("button", { name: "Skip Setup" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ setupDone: true })));
    expect(s.writes().map((w) => w.path)).toEqual(["/api/profile/setup-done"]);
  });

  it("Welcome: your name (shown as initials as you type) and email are needed to go on; they're saved", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} />);
    expect(within(step()).getByLabelText("Your initials")).toHaveTextContent("CO");
    expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled();
    await u.type(within(step()).getByLabelText("Your name"), "Cory Landers");
    expect(within(step()).getByLabelText("Your initials")).toHaveTextContent("CL");
    expect(within(step()).queryByText(/Passkey/)).toBeNull(); // that's its own step now
    await next(u);
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ path: "/api/profile", body: { displayName: "Cory Landers", username: "cory", email: "cory@example.com" } }));
    expect(await at(2, "Sign in with a passkey")).toBeInTheDocument();
  });

  describe("Passkey", () => {
    it("what it is (behind the i), and whether you have one; it can be skipped", async () => {
      routes({ "GET /api/auth/passkeys": () => [{ id: 1, name: "MacBook" }] });
      const u = userEvent.setup();
      render(<SetupWizard user={{ ...owner, displayName: "Cory" }} onDone={() => {}} start={S.passkey} />);
      expect(await within(step()).findByText("Passkey registered")).toBeInTheDocument();
      expect(within(step()).queryByText(/Touch ID, Face ID/)).toBeNull();
      await u.click(within(step()).getByRole("button", { name: "What's a passkey?" }));
      expect(within(step()).getByText(/Touch ID, Face ID/)).toBeInTheDocument();
      await next(u);
      expect(await at(3, "Choose an AI")).toBeInTheDocument();
    });

    it("no passkey yet: says so", async () => {
      routes();
      render(<SetupWizard user={{ ...owner, displayName: "Cory" }} onDone={() => {}} start={S.passkey} />);
      expect(await within(step()).findByText("No passkey yet")).toBeInTheDocument();
    });
  });

  describe("AI", () => {
    it("Choose an AI: optional, a short with/without table, and the providers", async () => {
      routes();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.ai} />);
      expect(within(step()).getByText(/optional but recommended/i)).toBeInTheDocument();
      const table = within(step()).getByRole("table", { name: "With and without AI" });
      expect(within(table).getAllByRole("row")).toHaveLength(5); // the heading and 4 rows
      expect(within(table).getByRole("row", { name: /Photos and PDFs/ })).toHaveTextContent(/No.*Reads them/);
      expect(within(step()).getAllByRole("radio")).toHaveLength(5);
    });

    it("pick a provider, then Connect: the key, a recommended model, Test, and Next saves it", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.ai} />);
      await u.click(within(step()).getByRole("radio", { name: /Anthropic/ }));
      await next(u);
      expect(await at(4, "Connect Anthropic")).toBeInTheDocument();
      // how to get a key: one link away
      expect(within(step()).queryByRole("list", { name: "How to get a key" })).toBeNull();
      await u.click(within(step()).getByRole("button", { name: "How to get a key" }));
      const guide = within(step()).getByRole("list", { name: "How to get a key" });
      expect(within(guide).getByRole("link", { name: /console\.anthropic\.com/ })).toHaveAttribute("href", "https://console.anthropic.com/settings/keys");
      await u.type(within(step()).getByLabelText("API key"), "sk-ant-123");
      await u.click(within(step()).getByRole("button", { name: "Use claude-haiku-5-5" }));
      expect(within(step()).getByLabelText("Model")).toHaveValue("claude-haiku-5-5");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled();
      await u.click(within(step()).getByRole("button", { name: "Test Connection" }));
      expect(await within(step()).findByText("claude-haiku-5-5 answered correctly.")).toBeInTheDocument();
      await next(u);
      await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/ai")?.body).toMatchObject({ services: [{ provider: "anthropic", apiKey: "sk-ant-123", model: "claude-haiku-5-5", photos: true }] }));
      expect(await at(5, "Backup AI")).toBeInTheDocument();
      // no backup: skip it
      await u.click(within(dialog()).getByRole("button", { name: "Skip Backup" }));
      expect(await at(6, "Fine-Tune AI")).toBeInTheDocument();
      expect(within(step()).getByRole("switch", { name: /Improve with AI/ })).toBeEnabled();
    });

    it("a backup AI: tested too, saved second", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.ai} />);
      await next(u); // Local is picked to start with
      await at(4, "Connect Local");
      await u.type(within(step()).getByLabelText("Address"), "http://10.0.0.5:11434/v1");
      await u.type(within(step()).getByLabelText("Model"), "qwen3-vl:8b");
      await u.click(within(step()).getByRole("button", { name: "Test Connection" }));
      await within(step()).findByText("qwen3-vl:8b answered correctly.");
      await next(u);
      await at(5, "Backup AI");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled(); // nothing tested yet
      await u.selectOptions(within(step()).getByLabelText("Service"), "openrouter");
      await u.type(within(step()).getByLabelText("API key"), "sk-or-1");
      await u.type(within(step()).getByLabelText("Model"), "anthropic/claude-haiku-5.5");
      await u.click(within(step()).getByRole("button", { name: "Test Connection" }));
      await within(step()).findByText("anthropic/claude-haiku-5.5 answered correctly.");
      await next(u);
      await waitFor(() => expect(s.writes().filter((w) => w.path === "/api/settings/ai").at(-1)?.body.services).toMatchObject([{ provider: "local", model: "qwen3-vl:8b" }, { provider: "openrouter", model: "anthropic/claude-haiku-5.5", name: "OpenRouter (backup)" }]));
      expect(await at(6, "Fine-Tune AI")).toBeInTheDocument();
    });

    it("Skip AI Setup (on Choose or Connect): straight to Fine-Tune, where the AI switches say they need AI", async () => {
      routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.ai} />);
      await next(u);
      await at(4, "Connect Local");
      await u.click(within(dialog()).getByRole("button", { name: "Skip AI Setup" }));
      const prefs = await at(6, "Fine-Tune AI");
      expect(within(prefs).getByRole("switch", { name: /Improve with AI/ })).toBeDisabled();
      expect(within(prefs).getByRole("switch", { name: /Saved copies/ })).toBeEnabled();
      expect(within(prefs).getAllByText(/Needs AI/).length).toBeGreaterThan(0);
      // Back from Fine-Tune goes to Choose an AI (not the skipped ones)
      await u.click(within(dialog()).getByRole("button", { name: /Back/ }));
      expect(await at(3, "Choose an AI")).toBeInTheDocument();
    });
  });

  it("Fine-Tune AI: Improve with AI, Auto nutrition, saved copies for blocked sites", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={S.aiPrefs} aiReady />);
    await u.click(within(step()).getByRole("switch", { name: /Auto nutrition/ }));
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ aiEnhance: true, autoNutrition: false, savedCopies: true }));
    expect(await at(7, "Email")).toBeInTheDocument();
  });

  describe("Email", () => {
    it("four boxes and a test email; the test has to arrive before Next saves it", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.email} />);
      expect(within(step()).queryByLabelText("Culury's address")).toBeNull(); // under More options
      await u.selectOptions(within(step()).getByLabelText("Provider"), "gmail");
      await u.type(within(step()).getByLabelText("Username"), "cory@gmail.com");
      await u.type(within(step()).getByLabelText("Password"), "app-password");
      await u.type(within(step()).getByLabelText("From address"), "cory@gmail.com");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled();
      await u.click(within(step()).getByRole("button", { name: "Send a test email" }));
      expect(await within(step()).findByText("Sent a test email to cory@example.com.")).toBeInTheDocument();
      await next(u);
      await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/email")?.body).toMatchObject({ enabled: true, host: "smtp.gmail.com", port: 587, username: "cory@gmail.com", password: "app-password", fromAddress: "cory@gmail.com", appUrl: window.location.origin }));
      expect(await at(8, "Recipe & Meal Planning")).toBeInTheDocument();
    });

    it("More options: another server, Culury's address and the ports", async () => {
      routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.email} />);
      await u.click(within(step()).getByRole("button", { name: "More options" }));
      expect(within(step()).getByLabelText("Culury's address")).toHaveValue(window.location.origin);
      expect(within(step()).getByText(/587/)).toBeVisible();
      await u.selectOptions(within(step()).getByLabelText("Provider"), "custom");
      expect(within(step()).getByLabelText("Server")).toBeInTheDocument();
    });

    it("Skip Email Setup", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={S.email} />);
      await u.click(within(dialog()).getByRole("button", { name: "Skip Email Setup" }));
      expect(await screen.findByRole("region", { name: /Step 8 of 9/ })).toBeInTheDocument();
      expect(s.writes()).toEqual([]);
    });
  });

  it("Recipe & Meal Planning: measurements, Cook mode keeping the screen awake, Discover checking feeds", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={S.prefs} />);
    expect(within(step()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["As is", "Metric", "US"]);
    expect(within(step()).getByRole("radio", { name: "As is" })).toHaveAttribute("aria-checked", "true");
    await u.click(within(step()).getByRole("radio", { name: "Metric" }));
    await u.click(within(step()).getByRole("switch", { name: /Keep the screen awake/ }));
    await u.click(within(step()).getByRole("switch", { name: /Check feeds by themselves/ }));
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/profile")?.body).toEqual({ units: "metric", keepAwake: false }));
    expect(s.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ discoveryRefresh: false });
    expect(await at(9, "You're all set! 🎉")).toBeInTheDocument();
  });

  it("Done: the Companion extension, the Add recipe button, and Finish & Open Culury", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = routes();
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onDone = vi.fn();
    render(<SetupWizard user={owner} onDone={onDone} start={S.done} />);
    expect(within(step()).getByRole("link", { name: /Culury Companion/ })).toHaveAttribute("href", "https://github.com/cwland/Culury-Companion");
    expect(within(step()).getByText(/Add recipe/)).toBeInTheDocument();
    await u.click(within(dialog()).getByRole("button", { name: "Finish & Open Culury" }));
    await waitFor(() => expect(s.writes().map((w) => w.path)).toEqual(["/api/profile/setup-done"]));
    await act(async () => void vi.advanceTimersByTime(400)); // fades out first
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ setupDone: true }));
    vi.useRealTimers();
  });

  it("a member: Welcome, Passkey, Recipe & Meal Planning, Done (no AI or email; no Discover switch)", async () => {
    routes();
    const u = userEvent.setup();
    render(<SetupWizard user={member} onDone={() => {}} />);
    expect(step()).toHaveAccessibleName("Step 1 of 4: Welcome to Culury");
    await next(u);
    await at(2, "Sign in with a passkey", 4);
    await next(u);
    const prefs = await at(3, "Recipe & Meal Planning", 4);
    expect(within(prefs).queryByRole("switch", { name: /Check feeds/ })).toBeNull();
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
