import { useEffect, useState } from "react";
import { api } from "../api";
import { ago } from "./discovery/DiscoveryPage";
import { Card, Notice, Toggle, field, primaryButton, secondaryButton } from "./settingsUi";

// Settings › Email › Send recipes to Culury by email: a mailbox (IMAP) Culury checks every few
// minutes. Links land in the Inbox; a recipe written in an email lands as a note to import.

export const IMAP: { id: string; label: string; host: string; hint: string }[] = [
  { id: "gmail", label: "Gmail", host: "imap.gmail.com", hint: "Use an app password (Google Account › Security › App passwords). A new Gmail address just for recipes works well." },
  { id: "icloud", label: "iCloud Mail", host: "imap.mail.me.com", hint: "Use an app-specific password from account.apple.com." },
  { id: "outlook", label: "Outlook / Microsoft 365", host: "outlook.office365.com", hint: "Your full Outlook address and its password (or an app password with two-step sign-in)." },
  { id: "fastmail", label: "Fastmail", host: "imap.fastmail.com", hint: "Use an app password from Fastmail settings." },
];

interface Saved {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  allowedSenders: string[];
  hasPassword: boolean;
}
interface Info {
  configured: boolean;
  settings: Saved | null;
  status: { lastCheckedAt: string | null; lastAdded: number | null; lastError: string | null };
}
type Msg = { ok: boolean; text: string } | null;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function MailCaptureSettings() {
  const [info, setInfo] = useState<Info | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState("");
  const load = () =>
    api<Info>("GET", "/api/settings/mail-capture")
      .then(setInfo)
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => void load(), []);

  const s = info?.settings;
  const keep = (x: Saved) => ({ enabled: x.enabled, host: x.host, port: x.port, secure: x.secure, username: x.username, mailbox: x.mailbox, allowedSenders: x.allowedSenders });
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
  const toggle = (on: boolean) =>
    run("toggle", async () => {
      await api("PUT", "/api/settings/mail-capture", { ...keep(s!), enabled: on });
      await load();
    });
  const checkNow = () =>
    run("check", async () => {
      const r = await api<{ emails: number; added: number; skipped: number }>("POST", "/api/settings/mail-capture/check");
      setMsg({ ok: true, text: `Checked: ${plural(r.emails, "email")}, ${r.added} added to your Inbox.${r.skipped ? ` ${r.skipped} skipped (not from an allowed sender).` : ""}` });
      await load();
    });
  const remove = () =>
    run("remove", async () => {
      await api("DELETE", "/api/settings/mail-capture");
      await load();
    });

  const st = info?.status;
  return (
    <Card title="Send recipes to Culury by email" description="Forward a recipe email or a link to a mailbox Culury checks every few minutes. Links land in your Inbox, and a recipe written in an email lands as a note you can import with one click.">
      {!info ? (
        <p className="mt-3 text-sm text-subtle">Loading…</p>
      ) : editing || !s ? (
        !editing && !s ? (
          <button type="button" onClick={() => setEditing(true)} className={`${secondaryButton} mt-4`}>
            Set it up
          </button>
        ) : (
          <MailboxForm saved={s ?? null} onDone={() => (setEditing(false), void load())} onCancel={() => setEditing(false)} />
        )
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-6">
            <p className="text-sm">
              <span className="font-semibold">{s.username}</span>
              <span className="block text-subtle">
                {s.host}:{s.port} · {s.allowedSenders.length ? `only from ${s.allowedSenders.join(", ")}` : "from anyone"}
              </span>
            </p>
            <Toggle label="Check the mailbox" checked={s.enabled} disabled={!!busy} onChange={(v) => void toggle(v)} />
          </div>
          {st?.lastError ? (
            <p role="alert" className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
              Last check, {ago(st.lastCheckedAt)}: {st.lastError}
            </p>
          ) : (
            st?.lastCheckedAt && <p className="text-sm text-subtle">Last checked {ago(st.lastCheckedAt)}: {st.lastAdded ?? 0} added.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy || !s.enabled} onClick={() => void checkNow()} className={secondaryButton}>
              {busy === "check" ? "Checking…" : "Check now"}
            </button>
            <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
              Change settings
            </button>
            <button type="button" disabled={!!busy} onClick={() => void remove()} className="px-3 py-2 text-sm font-semibold text-error hover:underline">
              Remove
            </button>
          </div>
        </div>
      )}
      <p className="mt-3">
        <Notice msg={msg} />
      </p>
    </Card>
  );
}

function MailboxForm({ saved, onDone, onCancel }: { saved: Saved | null; onDone: () => void; onCancel: () => void }) {
  const known = saved ? IMAP.find((p) => p.host === saved.host) : IMAP[0];
  const [preset, setPreset] = useState(known?.id ?? "custom");
  const p = IMAP.find((x) => x.id === preset);
  const [host, setHost] = useState(saved && !known ? saved.host : "");
  const [port, setPort] = useState(String(saved?.port ?? 993));
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState("");
  const [allowed, setAllowed] = useState(saved?.allowedSenders.join(", ") ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState("");
  const body = {
    enabled: saved?.enabled ?? true,
    host: p?.host ?? host.trim(),
    port: p ? 993 : Number(port),
    secure: p ? true : Number(port) !== 143,
    username: username.trim(),
    ...(password ? { password } : {}),
    mailbox: saved?.mailbox ?? "INBOX",
    allowedSenders: allowed.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
  };
  const go = async (what: "test" | "save") => {
    setBusy(what);
    setMsg(null);
    try {
      if (what === "test") setMsg({ ok: true, text: (await api<{ message: string }>("POST", "/api/settings/mail-capture/test", body)).message });
      else {
        await api("PUT", "/api/settings/mail-capture", body);
        onDone();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const lab = "block text-sm font-semibold text-subtle";
  return (
    <div className="mt-4 flex max-w-xl flex-col gap-3">
      <label className={lab}>
        Provider
        <select value={preset} onChange={(e) => setPreset(e.target.value)} className={field}>
          {IMAP.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="custom">Another mail server (IMAP)</option>
        </select>
      </label>
      {p && <p className="-mt-2 text-sm text-subtle">{p.hint}</p>}
      {!p && (
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <label className={lab}>
            IMAP server
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" className={field} />
          </label>
          <label className={lab}>
            Port
            <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} className={field} />
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lab}>
          Email address
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" className={field} />
        </label>
        <label className={lab}>
          App password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={saved?.hasPassword ? "Saved (type to change)" : ""} autoComplete="new-password" className={field} />
        </label>
      </div>
      <div>
        <label className={lab}>
          Only from
          <input value={allowed} onChange={(e) => setAllowed(e.target.value)} aria-describedby="mc-only-from" placeholder="you@example.com, @yourfamily.com" className={field} />
        </label>
        <span id="mc-only-from" className="mt-1 block text-xs text-muted">
          Addresses (or @a-whole-domain) whose emails come in. Leave it empty to take email from anyone.
        </span>
      </div>
      <p className="text-xs text-muted">Receiving uses IMAP: port 993 with SSL/TLS, or 143 with STARTTLS. Culury reads unread emails in the Inbox folder and marks each one read.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy || !body.host || !body.username} onClick={() => void go("test")} className={secondaryButton}>
          {busy === "test" ? "Connecting…" : "Test the mailbox"}
        </button>
        <button type="button" disabled={!!busy || !body.host || !body.username || (!password && !saved?.hasPassword)} onClick={() => void go("save")} className={primaryButton}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 text-sm font-semibold text-subtle hover:underline">
          Cancel
        </button>
      </div>
      <Notice msg={msg} />
    </div>
  );
}
