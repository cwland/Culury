import { and, eq, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import type { Db } from "../db/index.js";
import { appSettings, inboxItems } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import type { EventBus } from "./events.js";
import { recipeFromText } from "./importRecipe.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

// Send recipes to Culury by email. Culury checks a mailbox (IMAP: a Gmail, iCloud or Outlook
// address just for recipes, or your own mail server) every few minutes, and each unread email
// lands in the Inbox:
//  - a recipe written out in the email (Ingredients / Instructions): a note, imported with one click
//  - one to five links: each a recipe link (Instagram links as Instagram)
//  - anything else (a newsletter full of links, a few words): a note, so nothing is lost
// Then it's marked read, so it never comes in twice. Only from the senders you allow, if you
// list any. No AI here: reading the email is plain code.

export interface CaptureConfig {
  host: string;
  port: number;
  secure: boolean; // TLS from the start (993); false: STARTTLS on 143
  username: string;
  password: string;
  mailbox: string;
}
export interface MailBox {
  unread(): Promise<{ uid: number; source: Buffer }[]>;
  markRead(uids: number[]): Promise<void>;
  close(): Promise<void>;
}
export type OpenMailbox = (cfg: CaptureConfig) => Promise<MailBox>;

// What's saved in app_settings under "mailCapture" (the password encrypted)
interface Stored {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnc: string | null;
  mailbox: string;
  allowedSenders: string[];
}
interface Status {
  lastCheckedAt: string | null;
  lastAdded: number | null;
  lastError: string | null;
}
export type CaptureSettings = Omit<Stored, "passwordEnc"> & { password?: string | null };

const MAX_PER_CHECK = 50;
const MAX_LINKS = 5; // more than this: a newsletter, kept as one note
const SKIP_LINK = /unsubscribe|optout|opt-out|list-manage\.com|\/manage[-_]?preferences|email-preferences|\.(png|jpe?g|gif|webp)(\?|$)/i;

// The real mailbox (imapflow)
export const imapMailbox: OpenMailbox = async (cfg) => {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.username, pass: cfg.password }, logger: false, socketTimeout: 30_000 });
  await client.connect();
  const lock = await client.getMailboxLock(cfg.mailbox || "INBOX");
  return {
    async unread() {
      const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, MAX_PER_CHECK);
      const out: { uid: number; source: Buffer }[] = [];
      if (!uids.length) return out;
      for await (const m of client.fetch(uids, { source: true }, { uid: true })) if (m.source) out.push({ uid: m.uid, source: m.source });
      return out;
    },
    async markRead(uids) {
      if (uids.length) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    },
    async close() {
      lock.release();
      await client.logout().catch(() => {});
    },
  };
};

// http(s) links in the email's text (or its HTML when there's no text), in order, without doubles
export function linksIn(text: string, html: string | null) {
  const found = text.trim() ? [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0]) : [...(html ?? "").matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  return found
    .map((u) => u.replace(/[.,;:!?]+$/, "").replace(/&amp;/g, "&"))
    .filter((u) => !SKIP_LINK.test(u) && !seen.has(u) && seen.add(u));
}

// "cory@example.com" or "@landers.family" (a whole domain); none listed: anyone
export function senderAllowed(address: string, allowed: string[]) {
  if (!allowed.length) return true;
  const a = address.trim().toLowerCase();
  return allowed.some((x) => {
    const w = x.trim().toLowerCase();
    return w && (w.startsWith("@") ? a.endsWith(w) : a === w);
  });
}

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export class MailCapture {
  private running: Promise<{ emails: number; added: number; skipped: number }> | null = null;

  constructor(
    private db: Db,
    private secret: string,
    private open: OpenMailbox = imapMailbox,
    private events?: EventBus,
  ) {}

  async stored(): Promise<Stored | null> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, "mailCapture"));
    return (row?.value as Stored) ?? null;
  }
  async status(): Promise<Status> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, "mailCaptureStatus"));
    return { lastCheckedAt: null, lastAdded: null, lastError: null, ...((row?.value as Partial<Status>) ?? {}) };
  }
  private async setStatus(s: Status) {
    await this.db
      .insert(appSettings)
      .values({ key: "mailCaptureStatus", value: s })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedAt: new Date() } });
  }

  // password: undefined keeps the saved one, "" forgets it
  async save(s: CaptureSettings) {
    const current = await this.stored();
    const { password, ...rest } = s;
    const passwordEnc = password === undefined || password === null ? current?.passwordEnc ?? null : password ? encryptSecret(password, this.secret) : null;
    const value: Stored = { ...rest, allowedSenders: [...new Set(rest.allowedSenders.map((x) => x.trim()).filter(Boolean))], passwordEnc };
    await this.db
      .insert(appSettings)
      .values({ key: "mailCapture", value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  async clear() {
    await this.db.delete(appSettings).where(sql`${appSettings.key} in ('mailCapture', 'mailCaptureStatus')`);
  }

  // The saved settings with their password (a blank password typed: the saved one)
  async config(s?: CaptureSettings): Promise<CaptureConfig> {
    const stored = await this.stored();
    const from = s ?? stored;
    if (!from?.host || !from.username) throw new Error("Fill in the mail server and username first");
    let password = s?.password || "";
    if (!password && stored?.passwordEnc) password = decryptSecret(stored.passwordEnc, this.secret) ?? "";
    if (!password) throw new Error("Enter the mailbox's password (or app password)");
    return { host: from.host, port: from.port, secure: from.secure, username: from.username, password, mailbox: from.mailbox || "INBOX" };
  }

  // Connect and count what's unread (reads nothing)
  async test(s?: CaptureSettings) {
    const cfg = await this.config(s);
    let box: MailBox;
    try {
      box = await this.open(cfg);
    } catch (e) {
      throw new Error(`Couldn't connect to ${cfg.host}: ${(e as Error).message}`);
    }
    try {
      const n = (await box.unread()).length;
      return `Connected to ${cfg.host}: ${n === 1 ? "1 unread email" : `${n} unread emails`} in ${cfg.mailbox}.`;
    } finally {
      await box.close();
    }
  }

  // Check now (one at a time: a check already running is shared)
  check() {
    this.running ??= this.checkOnce().finally(() => (this.running = null));
    return this.running;
  }

  // The timed check: only when it's set up and switched on
  async checkIfOn() {
    const s = await this.stored();
    if (!s?.enabled || !s.passwordEnc) return null;
    return this.check().catch(() => null); // remembered in the status, and logged
  }

  private async checkOnce() {
    const s = await this.stored();
    if (!s) throw new Error("Set up email capture first");
    if (!s.enabled) throw new Error("Email capture is switched off");
    const now = new Date().toISOString();
    let box: MailBox;
    try {
      box = await this.open(await this.config());
    } catch (e) {
      const msg = `Couldn't connect to ${s.host}: ${(e as Error).message}`;
      await this.setStatus({ lastCheckedAt: now, lastAdded: null, lastError: msg });
      await logEvent(this.db, { category: "email", level: "warning", source: s.username, event: "Couldn't check the recipe mailbox", detail: msg });
      throw new Error(msg);
    }
    let emails = 0;
    let added = 0;
    let skipped = 0;
    try {
      const unread = await box.unread();
      emails = unread.length;
      for (const m of unread) {
        const n = await this.take(m.source, s.allowedSenders).catch(async (e) => {
          await logEvent(this.db, { category: "email", level: "warning", source: s.username, event: "Couldn't read an email", detail: (e as Error).message });
          return 0;
        });
        if (n < 0) skipped++;
        else added += n;
        await box.markRead([m.uid]);
      }
    } finally {
      await box.close();
    }
    await this.setStatus({ lastCheckedAt: now, lastAdded: added, lastError: null });
    if (added) {
      await logEvent(this.db, { category: "email", level: "info", source: s.username, event: `${added === 1 ? "1 recipe" : `${added} recipes`} came in by email` });
      this.events?.emit({ topic: "inbox", by: null });
    }
    return { emails, added, skipped };
  }

  // One email into the Inbox: how many items it added (-1: a sender that isn't allowed)
  private async take(source: Buffer, allowed: string[]) {
    const mail = await simpleParser(source);
    const from = (mail.from as AddressObject | undefined)?.value?.[0];
    const address = from?.address ?? "";
    if (!senderAllowed(address, allowed)) {
      await logEvent(this.db, { category: "email", level: "info", source: address || "unknown", event: "Skipped an email from a sender that isn't allowed", detail: mail.subject ?? "" });
      return -1;
    }
    const sentBy = from?.name?.trim() || address || null;
    const subject = (mail.subject ?? "").trim();
    const html = typeof mail.html === "string" ? mail.html : null;
    const text = (mail.text ?? "").trim() || (html ? htmlToText(html) : "");
    const links = linksIn(mail.text ?? "", html);
    const note = async () => this.add({ type: "TEXT_NOTE", title: (subject || text.split("\n")[0] || "An email").slice(0, 200), content: text.slice(0, 50_000) || subject, url: null, sentBy });

    if (recipeFromText(subject ? `${subject}\n${text}` : text)) return note();
    if (links.length && links.length <= MAX_LINKS) {
      let n = 0;
      for (const url of links) {
        const instagram = /^https?:\/\/([^/]+\.)?instagram\.com\//i.test(url);
        n += await this.add({ type: instagram ? "INSTAGRAM_LINK" : "RECIPE_LINK", title: (links.length === 1 && subject ? subject : url).slice(0, 200), url: url.slice(0, 2000), content: null, sentBy });
      }
      return n;
    }
    return text || subject ? note() : 0;
  }

  // Into the Inbox, unless the same link (or note) is already waiting there
  private async add(i: { type: "RECIPE_LINK" | "INSTAGRAM_LINK" | "TEXT_NOTE"; title: string; url: string | null; content: string | null; sentBy: string | null }) {
    const same = i.url ? and(eq(inboxItems.url, i.url), sql`${inboxItems.type} <> 'TEXT_NOTE'`) : and(eq(inboxItems.type, "TEXT_NOTE"), eq(inboxItems.content, i.content ?? ""));
    const [waiting] = await this.db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(and(same, eq(inboxItems.status, "PENDING")))
      .limit(1);
    if (waiting) return 0;
    await this.db.insert(inboxItems).values({ type: i.type, title: i.title || "An email", url: i.url, content: i.content, sourceApp: "Email", sentBy: i.sentBy });
    return 1;
  }
}

// Every few minutes (MAIL_CAPTURE_MINUTES, default 5; 0 turns it off)
export function startMailCaptureSchedule(capture: MailCapture, minutes: number, onError: (e: unknown) => void) {
  if (!minutes || minutes <= 0) return () => {};
  const timer = setInterval(() => void capture.checkIfOn().catch(onError), minutes * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
