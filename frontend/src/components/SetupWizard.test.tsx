import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupWizard from "./SetupWizard";
import GettingStarted from "./GettingStarted";
import { fakeServer } from "../test/fakeServer";
import type { User } from "../session";

// The first sign-in: a cheerful wizard over the app. The owner: Welcome (name, passkey), AI, AI
// switches, Email (send recipes in, and send out), Preferences, Done. A member: Welcome,
// Preferences, Done. Skip Setup is always there.
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

describe("the setup wizard", () => {
  it("a modal over the app: six steps for the owner, a progress bar, and Skip Setup", async () => {
    routes();
    render(<SetupWizard user={owner} onDone={() => {}} />);
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(step()).toHaveAccessibleName("Step 1 of 6: Welcome to Culury");
    expect(within(dialog()).getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute("aria-valuenow", "1");
    expect(within(dialog()).getByRole("button", { name: "Skip Setup" })).toBeInTheDocument();
  });

  it("Skip Setup ends setup straight away", async () => {
    const s = routes();
    const u = userEvent.setup();
    const onDone = vi.fn();
    render(<SetupWizard user={owner} onDone={onDone} start={2} />);
    await u.click(within(dialog()).getByRole("button", { name: "Skip Setup" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ setupDone: true })));
    expect(s.writes().map((w) => w.path)).toEqual(["/api/profile/setup-done"]);
  });

  describe("Welcome", () => {
    it("your name (shown as initials as you type) and email are needed to go on; they're saved", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} />);
      expect(within(step()).getByLabelText("Your initials")).toHaveTextContent("CO");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled();
      await u.type(within(step()).getByLabelText("Your name"), "Cory Landers");
      expect(within(step()).getByLabelText("Your initials")).toHaveTextContent("CL");
      await next(u);
      await waitFor(() => expect(s.writes()[0]).toMatchObject({ path: "/api/profile", body: { displayName: "Cory Landers", username: "cory", email: "cory@example.com" } }));
      expect(await screen.findByRole("region", { name: "Step 2 of 6: AI Integration Setup" })).toBeInTheDocument();
    });

    it("the passkey: what it is, and whether you have one", async () => {
      routes({ "GET /api/auth/passkeys": () => [{ id: 1, name: "MacBook" }] });
      const u = userEvent.setup();
      render(<SetupWizard user={{ ...owner, displayName: "Cory" }} onDone={() => {}} />);
      expect(await within(step()).findByText("Passkey registered")).toBeInTheDocument();
      await u.click(within(step()).getByRole("button", { name: "What's a passkey?" }));
      expect(within(step()).getByText(/sign in with Touch ID, Face ID/)).toBeInTheDocument();
    });

    it("no passkey yet: says so", async () => {
      routes();
      render(<SetupWizard user={{ ...owner, displayName: "Cory" }} onDone={() => {}} />);
      expect(await within(step()).findByText("No passkey yet")).toBeInTheDocument();
    });
  });

  describe("AI", () => {
    it("optional, with what works with and without it", async () => {
      routes();
      render(<SetupWizard user={owner} onDone={() => {}} start={1} />);
      expect(within(step()).getByText(/optional but highly recommended/i)).toBeInTheDocument();
      const table = within(step()).getByRole("table", { name: "With and without AI" });
      expect(within(table).getByRole("row", { name: /Photos and scanned PDFs/ })).toHaveTextContent(/Not available.*Reads them/);
    });

    it("pick a provider: how to get its key, a recommended model, Test, then Next saves it", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={1} />);
      await u.click(within(step()).getByRole("radio", { name: /Anthropic/ }));
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
      expect(await screen.findByRole("region", { name: "Step 3 of 6: Fine-Tune AI" })).toBeInTheDocument();
    });

    it("a backup AI, asked when the first one fails or hits its limits: tested too, saved second", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={1} />);
      await u.click(within(step()).getByRole("radio", { name: /Local/ }));
      await u.type(within(step()).getByLabelText("Address"), "http://10.0.0.5:11434/v1");
      await u.type(within(step()).getByLabelText("Model"), "qwen3-vl:8b");
      await u.click(within(step()).getByRole("button", { name: "Test Connection" }));
      await within(step()).findByText("qwen3-vl:8b answered correctly.");
      await u.click(within(step()).getByRole("button", { name: /Add a backup AI/ }));
      const backup = within(step()).getByRole("group", { name: "Backup AI" });
      await u.selectOptions(within(backup).getByLabelText("Service"), "openrouter");
      await u.type(within(backup).getByLabelText("API key"), "sk-or-1");
      await u.type(within(backup).getByLabelText("Model"), "anthropic/claude-haiku-5.5");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled(); // the backup isn't tested yet
      await u.click(within(backup).getByRole("button", { name: "Test Connection" }));
      await within(backup).findByText("anthropic/claude-haiku-5.5 answered correctly.");
      await next(u);
      await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/ai")?.body.services).toMatchObject([{ provider: "local", model: "qwen3-vl:8b" }, { provider: "openrouter", model: "anthropic/claude-haiku-5.5" }]));
    });

    it("Skip AI Setup: the AI switches say they need AI", async () => {
      routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={1} />);
      await u.click(within(dialog()).getByRole("button", { name: "Skip AI Setup" }));
      const prefs = await screen.findByRole("region", { name: "Step 3 of 6: Fine-Tune AI" });
      expect(within(prefs).getByRole("switch", { name: /Improve with AI/ })).toBeDisabled();
      expect(within(prefs).getByRole("switch", { name: /Saved copies/ })).toBeEnabled();
      expect(within(prefs).getAllByText(/Needs AI/).length).toBeGreaterThan(0);
    });
  });

  it("Fine-Tune AI: Improve with AI, Auto nutrition, saved copies for blocked sites", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={2} aiReady />);
    await u.click(within(step()).getByRole("switch", { name: /Auto nutrition/ }));
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ aiEnhance: true, autoNutrition: false, savedCopies: true }));
    expect(await screen.findByRole("region", { name: "Step 4 of 6: Email" })).toBeInTheDocument();
  });

  describe("Email", () => {
    it("sending only: a test email has to arrive before Next saves it", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={3} />);
      expect(within(step()).queryByText(/Receive/)).toBeNull();
      await u.selectOptions(within(step()).getByLabelText("Provider"), "gmail");
      await u.type(within(step()).getByLabelText("Username"), "cory@gmail.com");
      await u.type(within(step()).getByLabelText("Password"), "app-password");
      await u.type(within(step()).getByLabelText("From address"), "cory@gmail.com");
      expect(within(dialog()).getByRole("button", { name: /^Next/ })).toBeDisabled();
      await u.click(within(step()).getByRole("button", { name: "Send a test email" }));
      expect(await within(step()).findByText("Sent a test email to cory@example.com.")).toBeInTheDocument();
      await next(u);
      await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/email")?.body).toMatchObject({ enabled: true, host: "smtp.gmail.com", port: 587, username: "cory@gmail.com", password: "app-password", fromAddress: "cory@gmail.com" }));
      expect(s.writes().some((w) => w.path.includes("mail-capture"))).toBe(false);
      expect(await screen.findByRole("region", { name: "Step 5 of 6: Recipe & Meal Planning" })).toBeInTheDocument();
    });

    it("manual setup details: the ports", async () => {
      routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={3} />);
      await u.click(within(step()).getByText("Manual setup details"));
      expect(within(step()).getByText(/587/)).toBeVisible();
    });

    it("Skip Email Setup", async () => {
      const s = routes();
      const u = userEvent.setup();
      render(<SetupWizard user={owner} onDone={() => {}} start={3} />);
      await u.click(within(dialog()).getByRole("button", { name: "Skip Email Setup" }));
      expect(await screen.findByRole("region", { name: /Step 5 of 6/ })).toBeInTheDocument();
      expect(s.writes()).toEqual([]);
    });
  });

  it("Preferences: measurements, Cook mode keeping the screen awake, Discover checking feeds", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<SetupWizard user={owner} onDone={() => {}} start={4} />);
    await u.click(within(step()).getByRole("radio", { name: /Metric/ }));
    await u.click(within(step()).getByRole("switch", { name: /Keep the screen awake/ }));
    await u.click(within(step()).getByRole("switch", { name: /Check feeds by themselves/ }));
    await next(u);
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/profile")?.body).toEqual({ units: "metric", keepAwake: false }));
    expect(s.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ discoveryRefresh: false });
    expect(await screen.findByRole("region", { name: "Step 6 of 6: You're all set! 🎉" })).toBeInTheDocument();
  });

  it("Done: the Companion extension, the Import button, and Finish & Open Culury", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = routes();
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onDone = vi.fn();
    render(<SetupWizard user={owner} onDone={onDone} start={5} />);
    expect(within(step()).getByRole("link", { name: /Culury Companion/ })).toHaveAttribute("href", "https://github.com/cwland/Culury-Companion");
    expect(within(step()).getByText(/click Add recipe/)).toBeInTheDocument();
    await u.click(within(dialog()).getByRole("button", { name: "Finish & Open Culury" }));
    await waitFor(() => expect(s.writes().map((w) => w.path)).toEqual(["/api/profile/setup-done"]));
    await act(async () => void vi.advanceTimersByTime(400)); // fades out first
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ setupDone: true }));
    vi.useRealTimers();
  });

  it("a member: Welcome, Preferences, Done (no AI or email; no Discover switch)", async () => {
    routes();
    const u = userEvent.setup();
    render(<SetupWizard user={member} onDone={() => {}} />);
    expect(step()).toHaveAccessibleName("Step 1 of 3: Welcome to Culury");
    await next(u);
    const prefs = await screen.findByRole("region", { name: "Step 2 of 3: Recipe & Meal Planning" });
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
