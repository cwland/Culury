import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { forgetAiStatus } from "../ai";
import { addPasskey, passkeyError, passkeysAvailable } from "../passkeys";
import type { User } from "../session";
import { PRESETS } from "./EmailSettings";
import { PROVIDERS } from "./AiSettings";
import { Logo } from "./Icons";

// The first sign-in: a few steps to set Culury up. The owner: about you, measurements, a passkey,
// email (optional), AI (optional, recommended) and its preferences, the starting categories.
// A member: about you, measurements, a passkey. A step with a test (email, AI) only goes on once
// the test works; the optional ones can be skipped.

type StepId = "about" | "units" | "passkey" | "email" | "ai" | "aiPrefs" | "categories";
const TITLES: Record<StepId, string> = { about: "About you", units: "Measurements", passkey: "Passkey", email: "Email", ai: "AI", aiPrefs: "AI preferences", categories: "Categories and tags" };

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const label = "block text-sm font-semibold text-subtle";
const primary = "rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-50";
const secondary = "rounded-lg border border-line px-4 py-2.5 font-semibold hover:bg-pressed disabled:opacity-50";

export default function SetupWizard({ user, onDone, start = 0 }: { user: User; onDone: (u: User) => void; start?: number }) {
  const owner = user.role !== "member";
  const steps: StepId[] = owner ? ["about", "units", "passkey", "email", "ai", "aiPrefs", "categories"] : ["about", "units", "passkey"];
  const [at, setAt] = useState(start);
  const [me, setMe] = useState(user);
  const [aiSaved, setAiSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // ready: this step's checks pass; save: what Continue does first
  const [ready, setReady] = useState(false);
  const save = useRef<() => Promise<void>>(async () => {});
  const id = steps[at];

  const finish = async () => {
    const r = await api<{ user: User }>("POST", "/api/profile/setup-done");
    onDone(r.user);
  };
  // the next step (AI preferences only once an AI service is saved)
  const go = (from: number, aiNow = aiSaved) => {
    let n = from + 1;
    if (steps[n] === "aiPrefs" && !aiNow) n++;
    if (n >= steps.length) return void finish().catch((e) => setError((e as Error).message));
    setReady(false);
    save.current = async () => {};
    setError("");
    setAt(n);
  };
  const onContinue = async () => {
    setBusy(true);
    setError("");
    try {
      await save.current();
      go(at, id === "ai" ? true : aiSaved);
      if (id === "ai") setAiSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const back = () => {
    let n = at - 1;
    if (steps[n] === "aiPrefs" && !aiSaved) n--;
    setReady(false);
    setError("");
    setAt(Math.max(0, n));
  };
  // each step tells the wizard whether it's ready and what Continue saves
  const step = (ok: boolean, fn: () => Promise<void>) => {
    save.current = fn;
    if (ok !== ready) setReady(ok);
  };
  const optional = id === "passkey" || id === "email" || id === "ai";
  const last = at === steps.length - 1;

  return (
    <div className="min-h-screen bg-page px-4 py-6 sm:py-10">
      <div className="mx-auto flex max-w-[44rem] flex-col gap-5">
        <header className="flex items-center gap-2">
          <Logo className="size-8" />
          <div>
            <p className="font-semibold">Welcome to Culury</p>
            <p className="text-sm text-subtle">Let's set things up. It takes a couple of minutes.</p>
          </div>
        </header>
        <ol aria-label="Setup steps" className="flex flex-wrap gap-1.5 text-xs font-semibold">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === at ? "step" : undefined} className={`rounded-full px-2.5 py-1 ${i === at ? "bg-action text-white" : i < at ? "bg-brand-subtle text-action" : "bg-container text-subtle"}`}>
              {TITLES[s]}
            </li>
          ))}
        </ol>
        <section aria-label={`Step ${at + 1} of ${steps.length}: ${TITLES[id]}`} className="flex flex-col gap-4 rounded-2xl bg-container p-5 sm:p-7">
          <h1 className="text-2xl font-semibold">{TITLES[id]}</h1>
          {id === "about" && <About user={me} step={step} onSaved={setMe} />}
          {id === "units" && <Units user={me} step={step} />}
          {id === "passkey" && <Passkey step={step} />}
          {id === "email" && <Email user={me} step={step} />}
          {id === "ai" && <Ai step={step} />}
          {id === "aiPrefs" && <AiPrefs step={step} />}
          {id === "categories" && <Categories step={step} />}
          {error && (
            <p role="alert" className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {at > 0 && (
              <button type="button" onClick={back} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
                Back
              </button>
            )}
            <span className="ml-auto" />
            {optional && (
              <button type="button" onClick={() => go(at)} className={secondary}>
                Skip for now
              </button>
            )}
            <button type="button" disabled={!ready || busy} onClick={() => void onContinue()} className={primary}>
              {busy ? "Saving…" : last ? "Finish" : "Continue"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

type StepProps = { step: (ready: boolean, save: () => Promise<void>) => void };

// ---------- about you ----------
function About({ user, step, onSaved }: StepProps & { user: User; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email ?? "");
  const ok = !!name.trim() && !!username.trim() && /^\S+@\S+\.\S+$/.test(email.trim());
  useEffect(() => {
    step(ok, async () => {
      const r = await api<{ user: User }>("PATCH", "/api/profile", { displayName: name.trim(), username: username.trim(), email: email.trim() });
      onSaved(r.user);
    });
  });
  return (
    <>
      <p className="text-subtle">How you'll show up to the rest of the household, and where password resets go.</p>
      <label className={label}>
        Full name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Cory Landers" className={field} />
      </label>
      <label className={label}>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={100} autoComplete="username" className={field} />
      </label>
      <label className={label}>
        Email address
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={field} />
      </label>
    </>
  );
}

// ---------- measurements ----------
function Units({ user, step }: StepProps & { user: User }) {
  const [units, setUnits] = useState<string>(user.units ?? "original");
  useEffect(() => step(true, async () => void (await api("PATCH", "/api/profile", { units }))));
  const choice = (value: string, title: string, hint: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${units === value ? "border-action bg-brand-subtle" : "border-line hover:bg-page"}`}>
      <input type="radio" name="units" checked={units === value} onChange={() => setUnits(value)} className="mt-1 size-4 accent-[var(--color-action)]" />
      <span>
        <span className="font-semibold">{title}</span>
        <span className="block text-sm text-subtle">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <p className="text-subtle">How amounts show when you open a recipe. You can switch on any recipe, any time.</p>
      {choice("original", "As is", "Each recipe the way it was written")}
      {choice("metric", "Metric", "Grams, millilitres and °C")}
      {choice("us", "US", "Cups, ounces, pounds and °F")}
    </>
  );
}

// ---------- passkey ----------
function Passkey({ step }: StepProps) {
  const [info, setInfo] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const can = passkeysAvailable();
  useEffect(() => step(added, async () => {}));
  const add = async () => {
    setError("");
    try {
      await addPasskey();
      setAdded(true);
    } catch (e) {
      const msg = passkeyError(e);
      if (msg) setError(msg);
    }
  };
  return (
    <>
      <p className="flex items-center gap-2 text-subtle">
        Sign in faster, without your password.
        <button type="button" aria-label="What's a passkey?" title="What's a passkey?" aria-expanded={info} onClick={() => setInfo(!info)} className="flex size-6 items-center justify-center rounded-full border border-line text-xs font-bold text-subtle hover:bg-pressed">
          i
        </button>
      </p>
      {info && (
        <p className="rounded-lg bg-page p-3 text-sm">
          A passkey lets you sign in with Touch ID, Face ID, Windows Hello or your phone instead of typing a password. It's kept on your device (and in your password manager or iCloud Keychain, if you use one), it only works on this Culury, and it can't be guessed or tricked out of you by a fake site. Your password still works too.
        </p>
      )}
      {!can && <p className="text-sm text-subtle">This browser can't add a passkey here (they need https:// or localhost). You can add one later in Settings › Security.</p>}
      {can && !added && (
        <button type="button" onClick={() => void add()} className={`${secondary} self-start`}>
          Add a passkey
        </button>
      )}
      {added && (
        <p role="status" className="font-semibold text-success">
          Passkey added. Next time, sign in with it.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </>
  );
}

// ---------- email ----------
function Email({ user, step }: StepProps & { user: User }) {
  const [provider, setProvider] = useState("gmail");
  const preset = PRESETS.find((p) => p.id === provider);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [appUrl, setAppUrl] = useState(window.location.origin);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const settings = {
    enabled: true,
    host: preset?.host ?? host.trim(),
    port: preset?.port ?? Number(port),
    security: preset?.security ?? (Number(port) === 465 ? "ssl" : "starttls"),
    username: username.trim(),
    password,
    fromName: "Culury",
    fromAddress: from.trim(),
    appUrl: appUrl.trim(),
  };
  // a change means testing again
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setTested(null));
  useEffect(() => step(!!tested?.ok, async () => void (await api("PUT", "/api/settings/email", settings))));
  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ message: string }>("POST", "/api/settings/email/test", { settings, ...(user.email ? { to: user.email } : {}) });
      setTested({ ok: true, text: r.message });
    } catch (e) {
      setTested({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  };
  return (
    <>
      <p className="text-subtle">Optional. Lets Culury send password resets, shared recipes, grocery lists and meal plan reminders. A test email has to arrive before you go on.</p>
      <label className={label}>
        Provider
        <select value={provider} onChange={(e) => changed(setProvider)(e.target.value)} className={field}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Another server</option>
        </select>
      </label>
      {preset && <p className="-mt-2 text-sm text-subtle">{preset.hint}</p>}
      {!preset && (
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <label className={label}>
            Server
            <input value={host} onChange={(e) => changed(setHost)(e.target.value)} placeholder="smtp.example.com" className={field} />
          </label>
          <label className={label}>
            Port
            <input value={port} inputMode="numeric" onChange={(e) => changed(setPort)(e.target.value)} className={field} />
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Username
          <input value={username} onChange={(e) => changed(setUsername)(e.target.value)} autoComplete="off" className={field} />
        </label>
        <label className={label}>
          Password
          <input type="password" value={password} onChange={(e) => changed(setPassword)(e.target.value)} autoComplete="new-password" className={field} />
        </label>
      </div>
      <label className={label}>
        From address
        <input type="email" value={from} onChange={(e) => changed(setFrom)(e.target.value)} placeholder="recipes@example.com" className={field} />
      </label>
      <label className={label}>
        Culury's address
        <input value={appUrl} onChange={(e) => changed(setAppUrl)(e.target.value)} className={field} />
        <span className="mt-1 block text-xs font-normal text-muted">Used for links in emails, like Open the recipe. Use the address people reach Culury on.</span>
      </label>
      <button type="button" disabled={testing || !settings.host || !settings.fromAddress} onClick={() => void test()} className={`${secondary} self-start`}>
        {testing ? "Sending…" : "Send a test email"}
      </button>
      {tested && (
        <p role={tested.ok ? "status" : "alert"} className={`text-sm font-semibold ${tested.ok ? "text-success" : "text-error"}`}>
          {tested.text}
        </p>
      )}
    </>
  );
}

// ---------- AI ----------
function Ai({ step }: StepProps) {
  const [provider, setProvider] = useState("local");
  const p = PROVIDERS.find((x) => x.id === provider)!;
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [photos, setPhotos] = useState(false);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const body = { name: p.name, enabled: true, provider, model: model.trim(), baseUrl: provider === "local" ? baseUrl.trim() : null, apiKey: apiKey.trim(), quick: true, photos };
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setTested(null));
  useEffect(() =>
    step(!!tested?.ok, async () => {
      await api("PUT", "/api/settings/ai", { maxPerRun: 50, timeoutSec: 15, askNextOnNoMatch: false, services: [body] });
      forgetAiStatus();
    })
  );
  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ message: string }>("POST", "/api/settings/ai/test", body);
      setTested({ ok: true, text: r.message });
    } catch (e) {
      setTested({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  };
  return (
    <>
      <p className="text-subtle">
        Optional, but highly recommended. AI reads recipes from any page, photos and PDFs, checks and tidies recipes, works out nutrition and suggests meals. A home AI (like Ollama) keeps everything on your network. You can add more services later in Settings › AI.
      </p>
      <label className={label}>
        Service
        <select value={provider} onChange={(e) => changed(setProvider)(e.target.value)} className={field}>
          {PROVIDERS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">{p.hint}</span>
      </label>
      {provider === "local" ? (
        <label className={label}>
          Address
          <input value={baseUrl} onChange={(e) => changed(setBaseUrl)(e.target.value)} placeholder="http://192.168.1.20:11434/v1" className={field} />
        </label>
      ) : (
        <label className={label}>
          API key
          <input type="password" value={apiKey} onChange={(e) => changed(setApiKey)(e.target.value)} autoComplete="off" className={field} />
          {p.keyUrl && (
            <a href={p.keyUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-xs font-semibold text-link hover:underline">
              Get a key ↗
            </a>
          )}
        </label>
      )}
      <label className={label}>
        Model
        <input value={model} onChange={(e) => changed(setModel)(e.target.value)} placeholder={provider === "local" ? "qwen3:14b" : "the model's name"} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
        This model can read photos (recipe cards, screenshots, scanned PDFs)
      </label>
      <button type="button" disabled={testing || !body.model || (provider === "local" ? !body.baseUrl : !body.apiKey)} onClick={() => void test()} className={`${secondary} self-start`}>
        {testing ? "Testing…" : "Test connection"}
      </button>
      {tested && (
        <p role={tested.ok ? "status" : "alert"} className={`text-sm font-semibold ${tested.ok ? "text-success" : "text-error"}`}>
          {tested.text}
        </p>
      )}
    </>
  );
}

// ---------- AI preferences ----------
function AiPrefs({ step }: StepProps) {
  const [enhance, setEnhance] = useState(true);
  const [nutrition, setNutrition] = useState(true);
  useEffect(() => step(true, async () => void (await api("PUT", "/api/settings/features", { aiEnhance: enhance, autoNutrition: nutrition }))));
  const box = (on: boolean, set: (v: boolean) => void, title: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 hover:bg-page">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-1 size-4 accent-[var(--color-action)]" />
      <span>
        <span className="font-semibold">{title}</span>
        <span className="block text-sm text-subtle">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <p className="text-subtle">What the AI does for you. Change these any time in Settings › AI.</p>
      {box(enhance, setEnhance, "Improve with AI", "After you add a recipe, check it with AI: tidy the ingredients, fill gaps in the steps, suggest categories and tags. You accept or reject each change.")}
      {box(nutrition, setNutrition, "Auto nutrition", "Work out nutrition for each recipe by itself, and again when its ingredients change.")}
    </>
  );
}

// ---------- categories and tags ----------
function Categories({ step }: StepProps) {
  const [cats, setCats] = useState<{ id: number; name: string }[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ id: number; name: string }[]>("GET", "/api/categories")
      .then(setCats)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => step(!!cats, async () => {}));
  const remove = async (id: number) => {
    setError("");
    try {
      await api("DELETE", `/api/categories/${id}`);
      setCats((c) => c!.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      const c = await api<{ id: number; name: string }>("POST", "/api/categories", { name: name.trim() });
      setCats((x) => [...(x ?? []), c]);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <p className="text-subtle">Categories are meal types or courses. Here are the ones Culury starts with: keep them, remove the ones you won't use, or add your own.</p>
      <ul aria-label="Categories" className="flex flex-wrap gap-2">
        {cats?.map((c) => (
          <li key={c.id} className="flex items-center gap-1 rounded-full bg-brand-subtle py-1 pl-3 pr-1 text-sm font-semibold text-action">
            {c.name}
            <button type="button" aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`} onClick={() => void remove(c.id)} className="flex size-5 items-center justify-center rounded-full hover:bg-action/15">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void add(e)} className="flex gap-2">
        <input aria-label="New category" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`${field} mt-0 flex-1`} />
        <button type="submit" disabled={!name.trim()} className={secondary}>
          Add
        </button>
      </form>
      <Note>
        <strong>Tags</strong> are added on each recipe (like quick, spicy or vegetarian), by you or by Improve with AI. They show up in Settings › Recipes once you have some.
      </Note>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-page p-3 text-sm text-subtle">{children}</p>;
