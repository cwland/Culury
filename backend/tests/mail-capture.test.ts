import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Send recipes to Culury by email: Culury checks a mailbox (IMAP) every few minutes. A link lands
// in the Inbox as a recipe link; a recipe written out in the email lands as a note to import. Each
// email is marked read, so nothing comes in twice.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const settings = { enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@example.com", password: "app-password", mailbox: "INBOX", allowedSenders: [] as string[] };
const email = (o: { from?: string; subject?: string; text?: string; html?: string }) => {
  const from = o.from ?? "Cory Landers <cory@example.com>";
  const head = `From: ${from}\r\nTo: recipes@example.com\r\nSubject: ${o.subject ?? "A recipe"}\r\nDate: Wed, 04 Nov 2026 12:00:00 +0000\r\nMessage-ID: <${Math.random()}@example.com>\r\nMIME-Version: 1.0\r\n`;
  if (o.html && !o.text) return `${head}Content-Type: text/html; charset=utf-8\r\n\r\n${o.html}\r\n`;
  return `${head}Content-Type: text/plain; charset=utf-8\r\n\r\n${o.text ?? ""}\r\n`;
};
const arrive = (...sources: string[]) => sources.forEach((source) => t.mailbox.messages.push({ uid: t.mailbox.messages.length + 1, source }));
const setUp = async (over: object = {}) => expect((await t.api("PUT", "/api/settings/mail-capture", { ...settings, ...over })).status).toBe(200);
const check = async () => (await t.api("POST", "/api/settings/mail-capture/check")).body;
const inbox = async () => (await t.api("GET", "/api/inbox")).body as any[];

describe("email capture settings", () => {
  it("not set up at first; saved settings come back without the password", async () => {
    expect((await t.api("GET", "/api/settings/mail-capture")).body).toMatchObject({ configured: false, settings: null });
    await setUp({ allowedSenders: ["cory@example.com", "@landers.family"] });
    const r = (await t.api("GET", "/api/settings/mail-capture")).body;
    expect(r).toMatchObject({ configured: true, settings: { enabled: true, host: "imap.gmail.com", port: 993, secure: true, username: "recipes@example.com", mailbox: "INBOX", hasPassword: true, allowedSenders: ["cory@example.com", "@landers.family"] } });
    expect(JSON.stringify(r)).not.toContain("app-password");
  });

  it("saving again without a password keeps the saved one", async () => {
    await setUp();
    await setUp({ password: undefined, host: "imap.mail.me.com" });
    arrive(email({ text: "https://kitchen.example.com/pork" }));
    await check();
    expect(t.mailbox.opened.at(-1)).toMatchObject({ host: "imap.mail.me.com", username: "recipes@example.com", password: "app-password" });
  });

  it("Test: connects with the settings as typed and says how many unread emails there are", async () => {
    arrive(email({ text: "one" }), email({ text: "two" }));
    const r = await t.api("POST", "/api/settings/mail-capture/test", settings);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Connected to imap.gmail.com: 2 unread emails in INBOX.");
    expect(t.mailbox.messages.every((m) => !m.seen)).toBe(true); // a test reads nothing
  });

  it("Test: a mailbox that can't be reached says why", async () => {
    t.mailbox.fail = "Invalid credentials (Failure)";
    const r = await t.api("POST", "/api/settings/mail-capture/test", settings);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Couldn't connect to imap\.gmail\.com: Invalid credentials/);
  });

  it("is for signed-in people only", async () => {
    expect((await t.api("GET", "/api/settings/mail-capture", undefined, { authorization: "" })).status).toBe(401);
  });
});

describe("checking the mailbox", () => {
  it("a link lands in the Inbox as a recipe link (title from the subject, who sent it), and the email is marked read", async () => {
    await setUp();
    arrive(email({ subject: "Try this one", text: "Look!\nhttps://kitchen.example.com/pork-roast\n\nSent from my iPhone" }));
    expect(await check()).toMatchObject({ emails: 1, added: 1 });
    const [item] = await inbox();
    expect(item).toMatchObject({ type: "RECIPE_LINK", url: "https://kitchen.example.com/pork-roast", title: "Try this one", sourceApp: "Email", sentBy: "Cory Landers", status: "PENDING" });
    expect(t.mailbox.messages[0].seen).toBe(true);
    // checked again: nothing new
    expect(await check()).toMatchObject({ emails: 0, added: 0 });
    expect(await inbox()).toHaveLength(1);
  });

  it("an Instagram link is an Instagram item; links in HTML-only emails are found too", async () => {
    await setUp();
    arrive(email({ subject: "Reel", html: '<p>Watch <a href="https://www.instagram.com/reel/abc123/">this</a></p>' }));
    await check();
    expect((await inbox())[0]).toMatchObject({ type: "INSTAGRAM_LINK", url: "https://www.instagram.com/reel/abc123/" });
  });

  it("a recipe written out in the email lands as a note to import, even with a link in it", async () => {
    await setUp();
    const text = "Grandma's Pancakes\n\nIngredients\n2 cups flour\n2 eggs\n1 cup milk\n\nInstructions\nMix everything.\nCook on a hot griddle.\n\nFrom https://family.example.com";
    arrive(email({ subject: "Grandma's Pancakes", text }));
    await check();
    const items = await inbox();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "TEXT_NOTE", title: "Grandma's Pancakes", sourceApp: "Email" });
    expect(items[0].content).toContain("2 cups flour");
  });

  it("unsubscribe, mailto and tracking links are left out; a few links each land; the same link waiting isn't added twice", async () => {
    await setUp();
    arrive(
      email({ text: "https://a.example.com/one\nhttps://b.example.com/two\nmailto:me@example.com\nhttps://news.example.com/unsubscribe?u=1\nhttps://a.example.com/one" }),
      email({ text: "again: https://a.example.com/one" }),
    );
    expect(await check()).toMatchObject({ emails: 2, added: 2 });
    expect((await inbox()).map((i) => i.url).sort()).toEqual(["https://a.example.com/one", "https://b.example.com/two"]);
  });

  it("a newsletter full of links lands as one note, not dozens of links", async () => {
    await setUp();
    const links = Array.from({ length: 8 }, (_, i) => `https://news.example.com/recipe-${i}`).join("\n");
    arrive(email({ subject: "This week's recipes", text: `Our picks:\n${links}` }));
    await check();
    const items = await inbox();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "TEXT_NOTE", title: "This week's recipes" });
    expect(items[0].content).toContain("https://news.example.com/recipe-7");
  });

  it("only from the senders you allow (an address, or @a-whole-domain); others are skipped and marked read", async () => {
    await setUp({ allowedSenders: ["cory@example.com", "@landers.family"] });
    arrive(
      email({ from: "Spammer <deals@spam.example.com>", text: "https://spam.example.com/buy" }),
      email({ from: "sam@landers.family", text: "https://kitchen.example.com/soup" }),
      email({ from: "CORY@example.com", text: "https://kitchen.example.com/stew" }),
    );
    expect(await check()).toMatchObject({ emails: 3, added: 2, skipped: 1 });
    expect((await inbox()).map((i) => i.url).sort()).toEqual(["https://kitchen.example.com/soup", "https://kitchen.example.com/stew"]);
    expect(t.mailbox.messages.every((m) => m.seen)).toBe(true);
  });

  it("an email with nothing to use (no link, no recipe) still lands as a note, so nothing is lost", async () => {
    await setUp();
    arrive(email({ subject: "Ideas", text: "Make the lemon chicken again soon" }));
    await check();
    expect((await inbox())[0]).toMatchObject({ type: "TEXT_NOTE", title: "Ideas", content: "Make the lemon chicken again soon" });
  });

  it("the last check is remembered (when, how many, or why it failed)", async () => {
    await setUp();
    arrive(email({ text: "https://kitchen.example.com/pork" }));
    await check();
    expect((await t.api("GET", "/api/settings/mail-capture")).body.status).toMatchObject({ lastCheckedAt: expect.any(String), lastAdded: 1, lastError: null });
    t.mailbox.fail = "Connection timed out";
    const r = await t.api("POST", "/api/settings/mail-capture/check");
    expect(r.status).toBe(400);
    expect((await t.api("GET", "/api/settings/mail-capture")).body.status.lastError).toMatch(/Connection timed out/);
  });

  it("not set up, or switched off: Check now says so, and the timed check does nothing", async () => {
    expect((await t.api("POST", "/api/settings/mail-capture/check")).status).toBe(400);
    await setUp({ enabled: false });
    arrive(email({ text: "https://kitchen.example.com/pork" }));
    expect((await t.api("POST", "/api/settings/mail-capture/check")).status).toBe(400);
    await t.app.mailCapture.checkIfOn();
    expect(t.mailbox.opened).toHaveLength(0);
    await setUp({ enabled: true });
    await t.app.mailCapture.checkIfOn();
    expect(await inbox()).toHaveLength(1);
  });
});
