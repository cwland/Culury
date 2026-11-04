import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MailCaptureSettings from "./MailCaptureSettings";
import { fakeServer } from "../test/fakeServer";

// Settings › Email › Send recipes to Culury by email
const saved = { enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@gmail.com", mailbox: "INBOX", allowedSenders: ["cory@example.com"], hasPassword: true };

describe("email capture settings", () => {
  it("not set up: Set it up shows the form; Test, then Save", async () => {
    const s = fakeServer({
      "GET /api/settings/mail-capture": () => ({ configured: false, settings: null, status: { lastCheckedAt: null, lastAdded: null, lastError: null } }),
      "POST /api/settings/mail-capture/test": () => ({ ok: true, message: "Connected to imap.gmail.com: 3 unread emails in INBOX." }),
      "PUT /api/settings/mail-capture": () => ({ ok: true }),
    });
    const u = userEvent.setup();
    render(<MailCaptureSettings />);
    const card = await screen.findByRole("region", { name: "Send recipes to Culury by email" });
    await u.click(within(card).getByRole("button", { name: "Set it up" }));
    await u.selectOptions(within(card).getByLabelText("Provider"), "gmail");
    await u.type(within(card).getByLabelText("Email address"), "recipes@gmail.com");
    await u.type(within(card).getByLabelText("App password"), "pw");
    await u.type(within(card).getByLabelText("Only from"), "cory@example.com, @landers.family");
    await u.click(within(card).getByRole("button", { name: "Test the mailbox" }));
    expect(await within(card).findByText(/3 unread emails/)).toBeInTheDocument();
    await u.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "PUT")?.body).toEqual({ enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@gmail.com", password: "pw", mailbox: "INBOX", allowedSenders: ["cory@example.com", "@landers.family"] }));
  });

  it("set up: shows the last check, Check now, and saving without retyping the password", async () => {
    const s = fakeServer({
      "GET /api/settings/mail-capture": () => ({ configured: true, settings: saved, status: { lastCheckedAt: new Date().toISOString(), lastAdded: 2, lastError: null } }),
      "POST /api/settings/mail-capture/check": () => ({ emails: 1, added: 1, skipped: 0 }),
      "PUT /api/settings/mail-capture": () => ({ ok: true }),
    });
    const u = userEvent.setup();
    render(<MailCaptureSettings />);
    const card = await screen.findByRole("region", { name: "Send recipes to Culury by email" });
    expect(await within(card).findByText(/Last checked just now: 2 added/)).toBeInTheDocument();
    await u.click(within(card).getByRole("button", { name: "Check now" }));
    expect(await within(card).findByText("Checked: 1 email, 1 added to your Inbox.")).toBeInTheDocument();
    await u.click(within(card).getByRole("switch", { name: "Check the mailbox" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "PUT")?.body).toMatchObject({ enabled: false, host: "imap.gmail.com" }));
    expect(s.writes().find((w) => w.method === "PUT")?.body.password).toBeUndefined();
  });

  it("the last check failed: says why", async () => {
    fakeServer({ "GET /api/settings/mail-capture": () => ({ configured: true, settings: saved, status: { lastCheckedAt: new Date().toISOString(), lastAdded: null, lastError: "Couldn't connect to imap.gmail.com: Invalid credentials" } }) });
    render(<MailCaptureSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});
