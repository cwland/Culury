import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailAccountSettings from "./EmailAccount";
import { fakeServer } from "../test/fakeServer";
import type { User } from "../session";

// Settings › Email › Email account: one account (address + app password) to send, receive, or both
const user = { id: 1, username: "cory", displayName: "Cory", email: "cory@example.com", role: "owner" } as User;
const none = { "GET /api/settings/email": () => ({ source: "none", active: false, settings: null }), "GET /api/settings/mail-capture": () => ({ configured: false, settings: null, status: { lastCheckedAt: null, lastAdded: null, lastError: null } }) };
const ok = {
  "POST /api/settings/email/test": () => ({ ok: true, to: "cory@example.com" }),
  "POST /api/settings/mail-capture/test": () => ({ ok: true, message: "Connected to imap.gmail.com: 0 unread emails in INBOX." }),
  "PUT /api/settings/email": () => ({ ok: true }),
  "PUT /api/settings/mail-capture": () => ({ ok: true }),
};
const both = {
  "GET /api/settings/email": () => ({ source: "app", active: true, settings: { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "recipes@gmail.com", fromName: "Culury", fromAddress: "recipes@gmail.com", appUrl: "http://recipes.local" } }),
  "GET /api/settings/mail-capture": () => ({ configured: true, settings: { enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@gmail.com", mailbox: "INBOX", allowedSenders: ["cory@example.com"], hasPassword: true }, status: { lastCheckedAt: new Date().toISOString(), lastAdded: 2, lastError: null } }),
};
const card = () => screen.findByRole("region", { name: "Email account" });

describe("the email account", () => {
  it("one Gmail account for both: one address and app password, one Test for both, then Save sets up both", async () => {
    const s = fakeServer({ ...none, ...ok });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    await u.click(within(c).getByRole("button", { name: "Set up email" }));
    expect(within(c).getByRole("radio", { name: "Send and receive" })).toBeChecked();
    await u.type(within(c).getByLabelText("Email address"), "recipes@gmail.com");
    await u.type(within(c).getByLabelText("App password"), "abcd efgh");
    expect(within(c).getByRole("button", { name: "Save" })).toBeDisabled();
    await u.click(within(c).getByRole("button", { name: "Test sending and receiving" }));
    expect(await within(c).findByText("Sending: sent a test email to cory@example.com")).toBeInTheDocument();
    expect(within(c).getByText(/Receiving: Connected to imap\.gmail\.com/)).toBeInTheDocument();
    await u.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/mail-capture")?.body).toEqual({ enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@gmail.com", password: "abcd efgh", mailbox: "INBOX", allowedSenders: ["cory@example.com"] }));
    expect(s.writes().find((w) => w.path === "/api/settings/email")?.body).toMatchObject({ enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "recipes@gmail.com", password: "abcd efgh", fromAddress: "recipes@gmail.com" });
  });

  it("Send only: no receiving fields, only sending is tested and saved", async () => {
    const s = fakeServer({ ...none, ...ok });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    await u.click(within(c).getByRole("button", { name: "Set up email" }));
    await u.click(within(c).getByRole("radio", { name: "Send only" }));
    expect(within(c).queryByLabelText("Only from")).toBeNull();
    await u.type(within(c).getByLabelText("Email address"), "cory@gmail.com");
    await u.type(within(c).getByLabelText("App password"), "pw");
    await u.click(within(c).getByRole("button", { name: "Send a test email" }));
    await within(c).findByText(/^Sending:/);
    await u.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().filter((w) => w.method === "PUT").map((w) => w.path)).toEqual(["/api/settings/email"]));
    expect(s.writes().some((w) => w.path === "/api/settings/mail-capture/test")).toBe(false);
  });

  it("another mail server: both servers to fill in", async () => {
    fakeServer({ ...none, ...ok });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    await u.click(within(c).getByRole("button", { name: "Set up email" }));
    await u.selectOptions(within(c).getByLabelText("Provider"), "custom");
    expect(within(c).getByLabelText("Sending server (SMTP)")).toBeInTheDocument();
    expect(within(c).getByLabelText("Receiving server (IMAP)")).toBeInTheDocument();
    await u.click(within(c).getByRole("radio", { name: "Receive only" }));
    expect(within(c).queryByLabelText("Sending server (SMTP)")).toBeNull();
  });

  it("recipes in on a different account: its own address and password", async () => {
    const s = fakeServer({ ...none, ...ok });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    await u.click(within(c).getByRole("button", { name: "Set up email" }));
    await u.type(within(c).getByLabelText("Email address"), "cory@gmail.com");
    await u.type(within(c).getByLabelText("App password"), "main-pw");
    await u.click(within(c).getByRole("checkbox", { name: "Use a different account for receiving" }));
    const other = within(c).getByRole("group", { name: "Receiving account" });
    await u.selectOptions(within(other).getByLabelText("Receiving provider"), "icloud");
    await u.type(within(other).getByLabelText("Receiving email address"), "recipes@icloud.com");
    await u.type(within(other).getByLabelText("Receiving app password"), "icloud-pw");
    await u.click(within(c).getByRole("button", { name: "Test sending and receiving" }));
    await within(c).findByText(/^Receiving:/);
    await u.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/mail-capture")?.body).toMatchObject({ host: "imap.mail.me.com", username: "recipes@icloud.com", password: "icloud-pw" }));
    expect(s.writes().find((w) => w.path === "/api/settings/email")?.body).toMatchObject({ host: "smtp.gmail.com", username: "cory@gmail.com" });
  });

  it("set up: shows both, the last check, Check now and pausing receiving", async () => {
    const s = fakeServer({ ...both, ...ok, "POST /api/settings/mail-capture/check": () => ({ emails: 1, added: 1, skipped: 0 }) });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    expect(await within(c).findByText("From recipes@gmail.com (smtp.gmail.com)")).toBeInTheDocument();
    expect(within(c).getByText(/Last checked just now: 2 added/)).toBeInTheDocument();
    await u.click(within(c).getByRole("button", { name: "Check now" }));
    expect(await within(c).findByText("Checked: 1 email, 1 added to your Inbox.")).toBeInTheDocument();
    await u.click(within(c).getByRole("switch", { name: "Check the mailbox" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "PUT")?.body).toMatchObject({ enabled: false, host: "imap.gmail.com" }));
  });

  it("Change: filled in from what's saved (password kept unless typed); switching to Send only turns receiving off", async () => {
    const s = fakeServer({ ...both, ...ok });
    const u = userEvent.setup();
    render(<EmailAccountSettings user={user} />);
    const c = await card();
    await u.click(await within(c).findByRole("button", { name: "Change" }));
    expect(within(c).getByLabelText("Provider")).toHaveValue("gmail");
    expect(within(c).getByLabelText("Email address")).toHaveValue("recipes@gmail.com");
    expect(within(c).getByRole("radio", { name: "Send and receive" })).toBeChecked();
    await u.click(within(c).getByRole("radio", { name: "Send only" }));
    await u.click(within(c).getByRole("button", { name: "Send a test email" }));
    await within(c).findByText(/^Sending:/);
    await u.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/settings/mail-capture")?.body).toMatchObject({ enabled: false }));
    expect(s.writes().find((w) => w.path === "/api/settings/email")?.body.password).toBeUndefined();
  });

  it("the last check failed: says why", async () => {
    fakeServer({ ...both, "GET /api/settings/mail-capture": () => ({ ...both["GET /api/settings/mail-capture"](), status: { lastCheckedAt: new Date().toISOString(), lastAdded: null, lastError: "Couldn't connect to imap.gmail.com: Invalid credentials" } }) });
    render(<EmailAccountSettings user={user} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});
