import { useEffect, useState } from "react";
import { api } from "../api";
import type { User } from "../session";
import { ago } from "./discovery/DiscoveryPage";
import { Card, Notice, Toggle, secondaryButton, primaryButton } from "./settingsUi";

// One email account for Culury: the same address and app password both send (SMTP: password
// resets, sharing, meal plan emails) and receive (IMAP: recipes sent to Culury land in the Inbox).
// Pick Send only, Receive only, or both; Culury knows each provider's two servers. Recipes can come
// in on a different account ("Use a different account for receiving"). Used by the setup wizard and
// Settings › Email. Underneath it's still two settings: /api/settings/email and /mail-capture.

export type Mode = "send" | "receive" | "both";
export interface Provider {
  id: string;
  label: string;
  imap: string;
  smtp: string;
  smtpPort: number;
  security: "starttls" | "ssl";
  hint: string;
}
export const PROVIDERS: Provider[] = [
  { id: "gmail", label: "Gmail", imap: "imap.gmail.com", smtp: "smtp.gmail.com", smtpPort: 587, security: "starttls", hint: "Use an app password (Google Account › Security › App passwords), not your normal password. A new Gmail address just for recipes works well." },
  { id: "icloud", label: "iCloud Mail", imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", smtpPort: 587, security: "starttls", hint: "Use an app-specific password from account.apple.com." },
  { id: "outlook", label: "Outlook / Microsoft 365", imap: "outlook.office365.com", smtp: "smtp.office365.com", smtpPort: 587, security: "starttls", hint: "Your full Outlook address and its password (or an app password with two-step sign-in)." },
  { id: "fastmail", label: "Fastmail", imap: "imap.fastmail.com", smtp: "smtp.fastmail.com", smtpPort: 465, security: "ssl", hint: "Use an app password from Fastmail settings." },
];
const byHost = (host: string | null | undefined) => PROVIDERS.find((p) => p.imap === host || p.smtp === host);

type Result = { ok: boolean; text: string };
interface SavedSending {
  enabled: boolean;
  host: string;
  port: number;
  security: string;
  username: string | null;
  fromName: string | null;
  fromAddress: string;
  appUrl: string | null;
}
interface SavedReceiving {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  allowedSenders: string[];
  hasPassword: boolean;
}
export interface Saved {
  sending: SavedSending | null;
  receiving: SavedReceiving | null;
}

// The form's state, its two tests and its save (the wizard and Settings both use it)
export function useEmailAccount(user: User, saved: Saved = { sending: null, receiving: null }) {
  const s = saved.sending;
  const r = saved.receiving;
  const sp = byHost(s?.host);
  const rp = byHost(r?.host);
  const otherAccount = !!(s && r && s.username && r.username && s.username.toLowerCase() !== r.username.toLowerCase());
  const [mode, setMode] = useState<Mode>(s?.enabled && r?.enabled ? "both" : r?.enabled && !s?.enabled ? "receive" : s?.enabled ? "send" : "both");
  const [provider, setProvider] = useState(s ? (sp?.id ?? "custom") : r ? (rp?.id ?? "custom") : "gmail");
  const [address, setAddress] = useState(s?.username ?? s?.fromAddress ?? r?.username ?? "");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState(s && !sp ? s.host : "");
  const [smtpPort, setSmtpPort] = useState(String(s && !sp ? s.port : 587));
  const [imapHost, setImapHost] = useState(r && !rp && !otherAccount ? r.host : "");
  const [imapPort, setImapPort] = useState(String(r && !rp && !otherAccount ? r.port : 993));
  const [separate, setSeparate] = useState(otherAccount);
  const [rProvider, setRProvider] = useState(otherAccount ? (rp?.id ?? "custom") : "gmail");
  const [rAddress, setRAddress] = useState(otherAccount ? r!.username : "");
  const [rPassword, setRPassword] = useState("");
  const [rHost, setRHost] = useState(otherAccount && !rp ? r!.host : "");
  const [rPort, setRPort] = useState(String(otherAccount && !rp ? r!.port : 993));
  const [allowed, setAllowed] = useState((r?.allowedSenders ?? (user.email ? [user.email] : [])).join(", "));
  const [appUrl, setAppUrl] = useState(s?.appUrl ?? window.location.origin);
  const [results, setResults] = useState<Result[] | null>(null);
  const [testing, setTesting] = useState(false);

  const sends = mode !== "receive";
  const receives = mode !== "send";
  const p = PROVIDERS.find((x) => x.id === provider);
  const rp2 = PROVIDERS.find((x) => x.id === rProvider);
  const sending = {
    enabled: true,
    host: p?.smtp ?? smtpHost.trim(),
    port: p?.smtpPort ?? Number(smtpPort),
    security: p?.security ?? (Number(smtpPort) === 465 ? "ssl" : "starttls"),
    username: address.trim(),
    ...(password ? { password } : {}),
    fromName: s?.fromName ?? "Culury",
    fromAddress: address.trim(),
    appUrl: appUrl.trim(),
  };
  const capture = separate
    ? { enabled: true, host: rp2?.imap ?? rHost.trim(), port: rp2 ? 993 : Number(rPort), secure: rp2 ? true : Number(rPort) !== 143, username: rAddress.trim(), ...(rPassword ? { password: rPassword } : {}), mailbox: r?.mailbox ?? "INBOX", allowedSenders: allowed.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) }
    : { enabled: true, host: p?.imap ?? imapHost.trim(), port: p ? 993 : Number(imapPort), secure: p ? true : Number(imapPort) !== 143, username: address.trim(), ...(password ? { password } : {}), mailbox: r?.mailbox ?? "INBOX", allowedSenders: allowed.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) };
  // has a password: typed, or one saved for that part
  const sendReady = !!(sending.host && sending.username && (password || s));
  const receiveReady = !!(capture.host && capture.username && (separate ? rPassword || r?.hasPassword : password || r?.hasPassword));
  const filled = !!(address.trim() || password || rAddress.trim() || rPassword);
  const canTest = (!sends || sendReady) && (!receives || receiveReady);
  const tested = !!results && results.every((x) => x.ok);
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setResults(null));

  const test = async () => {
    setTesting(true);
    const out: Result[] = [];
    if (sends) {
      try {
        const res = await api<{ message?: string; to?: string }>("POST", "/api/settings/email/test", { settings: sending, ...(user.email ? { to: user.email } : {}) });
        out.push({ ok: true, text: `Sending: ${res.message ?? `sent a test email to ${res.to}`}` });
      } catch (e) {
        out.push({ ok: false, text: `Sending: ${(e as Error).message}` });
      }
    }
    if (receives) {
      try {
        out.push({ ok: true, text: `Receiving: ${(await api<{ message: string }>("POST", "/api/settings/mail-capture/test", capture)).message}` });
      } catch (e) {
        out.push({ ok: false, text: `Receiving: ${(e as Error).message}` });
      }
    }
    setResults(out);
    setTesting(false);
  };
  // What's chosen is switched on; a part that's no longer wanted is switched off (kept for later)
  const save = async () => {
    if (sends) await api("PUT", "/api/settings/email", sending);
    else if (s?.enabled) await api("PUT", "/api/settings/email", { enabled: false, host: s.host, port: s.port, security: s.security, username: s.username, fromName: s.fromName, fromAddress: s.fromAddress, appUrl: s.appUrl });
    if (receives) await api("PUT", "/api/settings/mail-capture", capture);
    else if (r?.enabled) await api("PUT", "/api/settings/mail-capture", { enabled: false, host: r.host, port: r.port, secure: r.secure, username: r.username, mailbox: r.mailbox, allowedSenders: r.allowedSenders });
  };

  const fields = (
    <EmailAccountFields
      {...{ mode, provider, address, password, smtpHost, smtpPort, imapHost, imapPort, separate, rProvider, rAddress, rPassword, rHost, rPort, allowed, appUrl, sends, receives, results, testing, canTest, test }}
      savedPassword={!!(s || r?.hasPassword)}
      savedReceivingPassword={!!r?.hasPassword}
      set={{ mode: changed(setMode), provider: changed(setProvider), address: changed(setAddress), password: changed(setPassword), smtpHost: changed(setSmtpHost), smtpPort: changed(setSmtpPort), imapHost: changed(setImapHost), imapPort: changed(setImapPort), separate: changed(setSeparate), rProvider: changed(setRProvider), rAddress: changed(setRAddress), rPassword: changed(setRPassword), rHost: changed(setRHost), rPort: changed(setRPort), allowed: changed(setAllowed), appUrl: changed(setAppUrl) }}
    />
  );
  return { fields, filled, tested, save, mode };
}

const fieldCls = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const lab = "block text-sm font-semibold text-subtle";

function EmailAccountFields(f: {
  mode: Mode;
  provider: string;
  address: string;
  password: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  separate: boolean;
  rProvider: string;
  rAddress: string;
  rPassword: string;
  rHost: string;
  rPort: string;
  allowed: string;
  appUrl: string;
  sends: boolean;
  receives: boolean;
  results: Result[] | null;
  testing: boolean;
  canTest: boolean;
  test: () => Promise<void>;
  savedPassword: boolean;
  savedReceivingPassword: boolean;
  set: Record<string, (v: never) => void>;
}) {
  const set = f.set as unknown as Record<string, (v: string | boolean) => void>;
  const p = PROVIDERS.find((x) => x.id === f.provider);
  const rp = PROVIDERS.find((x) => x.id === f.rProvider);
  const modeChoice = (value: Mode, title: string, hint: string) => (
    <label className={`flex cursor-pointer flex-col rounded-xl border-2 px-3 py-2 ${f.mode === value ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
      <input type="radio" name="email-mode" aria-label={title} checked={f.mode === value} onChange={() => set.mode(value)} className="sr-only" />
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-subtle">{hint}</span>
    </label>
  );
  const providerSelect = (value: string, onChange: (v: string) => void, name: string) => (
    <label className={lab}>
      {name}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldCls}>
        {PROVIDERS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
        <option value="custom">Another mail server</option>
      </select>
    </label>
  );
  const server = (label: string, host: string, setHost: (v: string) => void, portLabel: string, port: string, setPort: (v: string) => void, placeholder: string) => (
    <div className="grid grid-cols-[1fr_6rem] gap-3">
      <label className={lab}>
        {label}
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={placeholder} className={fieldCls} />
      </label>
      <label className={lab}>
        {portLabel}
        <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} className={fieldCls} />
      </label>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="What should Culury do with it?" className="grid grid-cols-3 gap-2">
        {modeChoice("both", "Send and receive", "Both, with one account")}
        {modeChoice("send", "Send only", "Resets, sharing, meal plans")}
        {modeChoice("receive", "Receive only", "Recipes sent to Culury")}
      </div>
      {providerSelect(f.provider, (v) => set.provider(v), "Provider")}
      {p && <p className="-mt-2 text-sm text-subtle">{p.hint}</p>}
      {!p && f.sends && server("Sending server (SMTP)", f.smtpHost, (v) => set.smtpHost(v), "Sending port", f.smtpPort, (v) => set.smtpPort(v), "smtp.example.com")}
      {!p && f.receives && !f.separate && server("Receiving server (IMAP)", f.imapHost, (v) => set.imapHost(v), "Receiving port", f.imapPort, (v) => set.imapPort(v), "imap.example.com")}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lab}>
          Email address
          <input value={f.address} onChange={(e) => set.address(e.target.value)} placeholder="recipes@gmail.com" autoComplete="off" className={fieldCls} />
        </label>
        <label className={lab}>
          App password
          <input type="password" value={f.password} onChange={(e) => set.password(e.target.value)} placeholder={f.savedPassword ? "Saved (type to change)" : ""} autoComplete="new-password" className={fieldCls} />
        </label>
      </div>
      {f.receives && f.mode === "both" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.separate} onChange={(e) => set.separate(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
          Use a different account for receiving
        </label>
      )}
      {f.receives && f.separate && f.mode === "both" && (
        <fieldset aria-label="Receiving account" className="flex flex-col gap-3 rounded-2xl border border-dashed border-strong p-3">
          <legend className="px-1 text-sm font-semibold">Receiving account</legend>
          {providerSelect(f.rProvider, (v) => set.rProvider(v), "Receiving provider")}
          {rp && <p className="-mt-2 text-sm text-subtle">{rp.hint}</p>}
          {!rp && server("Receiving server (IMAP)", f.rHost, (v) => set.rHost(v), "Receiving port", f.rPort, (v) => set.rPort(v), "imap.example.com")}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={lab}>
              Receiving email address
              <input value={f.rAddress} onChange={(e) => set.rAddress(e.target.value)} placeholder="recipes@gmail.com" autoComplete="off" className={fieldCls} />
            </label>
            <label className={lab}>
              Receiving app password
              <input type="password" value={f.rPassword} onChange={(e) => set.rPassword(e.target.value)} placeholder={f.savedReceivingPassword ? "Saved (type to change)" : ""} autoComplete="new-password" className={fieldCls} />
            </label>
          </div>
        </fieldset>
      )}
      {f.receives && (
        <div>
          <label className={lab}>
            Only from
            <input value={f.allowed} onChange={(e) => set.allowed(e.target.value)} aria-describedby="email-only-from" placeholder="you@example.com, @yourfamily.com" className={fieldCls} />
          </label>
          <span id="email-only-from" className="mt-1 block text-xs text-muted">
            Who can send recipes in: addresses, or @a-whole-domain. Leave it empty to take email from anyone.
          </span>
        </div>
      )}
      {f.sends && (
        <div>
          <label className={lab}>
            Culury's address
            <input value={f.appUrl} onChange={(e) => set.appUrl(e.target.value)} aria-describedby="email-app-url" className={fieldCls} />
          </label>
          <span id="email-app-url" className="mt-1 block text-xs text-muted">
            Used for links in emails, like Open the recipe. Use the address people reach Culury on.
          </span>
        </div>
      )}
      <button type="button" disabled={f.testing || !f.canTest} onClick={() => void f.test()} className={`${secondaryButton} self-start`}>
        {f.testing ? "Testing…" : f.mode === "both" ? "Test sending and receiving" : f.mode === "send" ? "Send a test email" : "Test the mailbox"}
      </button>
      {f.results?.map((x) => (
        <p key={x.text} role={x.ok ? "status" : "alert"} className={`text-sm font-semibold ${x.ok ? "text-success" : "text-error"}`}>
          {x.text}
        </p>
      ))}
    </div>
  );
}

// ---------- Settings › Email ----------
interface ReceivingInfo {
  configured: boolean;
  settings: SavedReceiving | null;
  status: { lastCheckedAt: string | null; lastAdded: number | null; lastError: string | null };
}
interface SendingInfo {
  source: "app" | "env" | "none";
  active: boolean;
  settings: SavedSending | null;
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function EmailAccountSettings({ user }: { user: User }) {
  const [sendInfo, setSendInfo] = useState<SendingInfo | null>(null);
  const [recvInfo, setRecvInfo] = useState<ReceivingInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const load = () =>
    Promise.all([api<SendingInfo>("GET", "/api/settings/email"), api<ReceivingInfo>("GET", "/api/settings/mail-capture")])
      .then(([a, b]) => (setSendInfo(a), setRecvInfo(b)))
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => void load(), []);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const sending = sendInfo?.source === "app" ? sendInfo.settings : null;
  const r = recvInfo?.settings ?? null;
  const st = recvInfo?.status;
  const keep = (x: SavedReceiving) => ({ host: x.host, port: x.port, secure: x.secure, username: x.username, mailbox: x.mailbox, allowedSenders: x.allowedSenders });

  return (
    <Card title="Email account" description="One account for sending (password resets, sharing, meal plan emails) and receiving (recipes sent to Culury land in your Inbox). Use it for one or both.">
      {!sendInfo || !recvInfo ? (
        <p className="mt-3 text-sm text-subtle">Loading…</p>
      ) : editing ? (
        <EditForm user={user} saved={{ sending, receiving: r }} onDone={() => (setEditing(false), void load())} onCancel={() => setEditing(false)} />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-6">
            <p className="text-sm">
              <span className="font-semibold">📤 Sending</span>
              <span className="block text-subtle">
                {sending?.enabled ? `From ${sending.fromAddress} (${sending.host})` : sendInfo.source === "env" ? "Using the server's .env settings (see More sending options)" : "Off"}
              </span>
            </p>
          </div>
          <div className="flex items-start justify-between gap-6">
            <p className="text-sm">
              <span className="font-semibold">📥 Receiving</span>
              <span className="block text-subtle">{r ? `${r.username} (${r.host}) · ${r.allowedSenders.length ? `only from ${r.allowedSenders.join(", ")}` : "from anyone"}` : "Off"}</span>
            </p>
            {r && (
              <Toggle
                label="Check the mailbox"
                checked={r.enabled}
                disabled={!!busy}
                onChange={(on) => void run("toggle", async () => (await api("PUT", "/api/settings/mail-capture", { ...keep(r), enabled: on }), await load()))}
              />
            )}
          </div>
          {r && st?.lastError && (
            <p role="alert" className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
              Last check, {ago(st.lastCheckedAt)}: {st.lastError}
            </p>
          )}
          {r && !st?.lastError && st?.lastCheckedAt && <p className="-mt-2 text-sm text-subtle">Last checked {ago(st.lastCheckedAt)}: {st.lastAdded ?? 0} added.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className={primaryButton}>
              {sending || r ? "Change" : "Set up email"}
            </button>
            {r?.enabled && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("check", async () => {
                    const x = await api<{ emails: number; added: number; skipped: number }>("POST", "/api/settings/mail-capture/check");
                    setMsg({ ok: true, text: `Checked: ${plural(x.emails, "email")}, ${x.added} added to your Inbox.${x.skipped ? ` ${x.skipped} skipped (not from an allowed sender).` : ""}` });
                    await load();
                  })
                }
                className={secondaryButton}
              >
                {busy === "check" ? "Checking…" : "Check now"}
              </button>
            )}
            {r && (
              <button type="button" disabled={!!busy} onClick={() => void run("remove", async () => (await api("DELETE", "/api/settings/mail-capture"), await load()))} className="px-3 py-2 text-sm font-semibold text-error hover:underline">
                Stop receiving
              </button>
            )}
          </div>
        </div>
      )}
      <p className="mt-3">
        <Notice msg={msg} />
      </p>
    </Card>
  );
}

function EditForm({ user, saved, onDone, onCancel }: { user: User; saved: Saved; onDone: () => void; onCancel: () => void }) {
  const a = useEmailAccount(user, saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Result | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await a.save();
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <div className="mt-4 flex max-w-xl flex-col gap-3">
      {a.fields}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" disabled={busy || !a.tested} onClick={() => void save()} className={primaryButton}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm font-semibold text-subtle hover:underline">
          Cancel
        </button>
        {!a.tested && <span className="text-xs text-muted">Test it first: Save waits for the test to work.</span>}
      </div>
      <Notice msg={msg} />
    </div>
  );
}
