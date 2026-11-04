import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { forgetAiStatus } from "../ai";
import { addPasskey, passkeyError, passkeysAvailable } from "../passkeys";
import { initialsOf, type User } from "../session";
import { PRESETS } from "./EmailSettings";
import { PROVIDERS } from "./AiSettings";
import { IMAP } from "./MailCaptureSettings";
import { Logo } from "./Icons";

// The first sign-in: a cheerful wizard over the app (the app shows, blurred, behind it).
// The owner: Welcome (name, passkey), AI, Fine-Tune AI, Email (send recipes in; let Culury send),
// Recipe & Meal Planning preferences, Done. A member: Welcome, preferences, Done.
// Skip Setup is always there; a step with a test (AI, email) goes on once the test works, or is
// skipped. Finish (or Skip Setup) marks setup done; the app then points at Add recipe.

type StepId = "welcome" | "ai" | "aiPrefs" | "email" | "prefs" | "done";
const TITLES: Record<StepId, string> = { welcome: "Welcome to Culury", ai: "AI Integration Setup", aiPrefs: "Fine-Tune AI", email: "Email", prefs: "Recipe & Meal Planning", done: "You're all set! 🎉" };
const NEXT: Record<StepId, string> = { welcome: "", ai: "Next: AI Configuration →", aiPrefs: "Next: Feature Controls →", email: "Next: Email Integration →", prefs: "Next: Recipe Preferences →", done: "Next: Finalize Setup →" };
const EMOJI: Record<StepId, string> = { welcome: "👋", ai: "✨", aiPrefs: "🎛️", email: "📬", prefs: "🍳", done: "🎉" };
const COMPANION = "https://github.com/cwland/Culury-Companion";

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const label = "block text-sm font-semibold text-subtle";
const primary = "rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-50";
const secondary = "rounded-lg border border-line px-4 py-2.5 font-semibold hover:bg-pressed disabled:opacity-50";

type StepProps = { step: (ready: boolean, save: () => Promise<void>) => void };
type Result = { ok: boolean; text: string } | null;

export default function SetupWizard({ user, onDone, start = 0, aiReady = false }: { user: User; onDone: (u: User) => void; start?: number; aiReady?: boolean }) {
  const owner = user.role !== "member";
  const steps: StepId[] = owner ? ["welcome", "ai", "aiPrefs", "email", "prefs", "done"] : ["welcome", "prefs", "done"];
  const [at, setAt] = useState(start);
  const [me, setMe] = useState(user);
  const [aiSaved, setAiSaved] = useState(aiReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  // ready: this step's checks pass; save: what Next does first
  const [ready, setReady] = useState(false);
  const save = useRef<() => Promise<void>>(async () => {});
  const id = steps[at];
  const last = at === steps.length - 1;

  // Done (or skipped): remembered, then the wizard fades away
  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("POST", "/api/profile/setup-done");
      setLeaving(true);
      setTimeout(() => onDone(r.user), 300);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const go = (n: number) => {
    setReady(false);
    save.current = async () => {};
    setError("");
    setAt(n);
  };
  const onNext = async () => {
    if (last) return finish();
    setBusy(true);
    setError("");
    try {
      await save.current();
      if (id === "ai") setAiSaved(true);
      go(at + 1);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  // each step tells the wizard whether it's ready and what Next saves
  const step = (ok: boolean, fn: () => Promise<void>) => {
    save.current = fn;
    if (ok !== ready) setReady(ok);
  };
  const skip = id === "ai" ? "Skip AI Setup" : id === "email" ? "Skip Email Setup" : null;
  const nextLabel = last ? "Finish & Open Culury" : NEXT[steps[at + 1]];
  const pct = Math.round(((at + 1) / steps.length) * 100);

  return (
    <div className={`fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/30 px-3 py-4 backdrop-blur-[8px] transition-opacity duration-300 sm:items-center sm:py-8 ${leaving ? "opacity-0" : "opacity-100"}`}>
      <div role="dialog" aria-modal="true" aria-label="Set up Culury" className="flex w-full max-w-[46rem] flex-col overflow-hidden rounded-3xl bg-container shadow-[0_24px_60px_rgba(16,24,32,0.28)]">
        {/* a cheerful header: the logo, where you are, and Skip Setup */}
        <header className="relative bg-gradient-to-br from-brand-subtle via-container to-[#fff6e0] px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-center gap-3">
            <Logo className="size-9" />
            <div className="mr-auto">
              <p className="font-semibold">Let's get Culury cooking</p>
              <p className="text-sm text-subtle">
                Step {at + 1} of {steps.length} · a couple of minutes, tops
              </p>
            </div>
            <button type="button" onClick={() => void finish()} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold text-subtle hover:bg-container/70 hover:text-ink disabled:opacity-50">
              Skip Setup
            </button>
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={at + 1} className="mt-4 h-2 overflow-hidden rounded-full bg-container/80">
            <div className="h-full rounded-full bg-action transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </header>

        <section aria-label={`Step ${at + 1} of ${steps.length}: ${TITLES[id]}`} className="flex flex-col gap-4 px-5 py-5 sm:px-7">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {id !== "done" && <span aria-hidden>{EMOJI[id]}</span>}
            {TITLES[id]}
          </h1>
          {id === "welcome" && <Welcome user={me} step={step} onSaved={setMe} />}
          {id === "ai" && <Ai step={step} />}
          {id === "aiPrefs" && <AiPrefs step={step} aiOn={aiSaved} />}
          {id === "email" && <Email user={me} step={step} />}
          {id === "prefs" && <Prefs user={me} owner={owner} step={step} />}
          {id === "done" && <Done step={step} />}
          {error && (
            <p role="alert" className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
        </section>

        <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 sm:px-7">
          {at > 0 && (
            <button type="button" onClick={() => go(at - 1)} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
              ← Back
            </button>
          )}
          <span className="ml-auto" />
          {skip && (
            <button type="button" onClick={() => go(at + 1)} className={secondary}>
              {skip}
            </button>
          )}
          <button type="button" disabled={!ready || busy} onClick={() => void onNext()} className={primary}>
            {busy ? "Saving…" : nextLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------- pieces ----------

const Note = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-page p-3 text-sm text-subtle">{children}</p>;

function Status({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role={r.ok ? "status" : "alert"} className={`text-sm font-semibold ${r.ok ? "text-success" : "text-error"}`}>
      {r.text}
    </p>
  );
}

// An on/off switch with its explanation (needs: why it can't be switched now)
function Switch({ on, set, title, hint, needs }: { on: boolean; set: (v: boolean) => void; title: string; hint: string; needs?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-line px-4 py-3 ${needs ? "opacity-70" : ""}`}>
      <span className="flex-1">
        <span className="font-semibold">{title}</span>
        <span className="block text-sm text-subtle">{hint}</span>
        {needs && <span className="mt-1 block text-xs font-semibold text-muted">{needs}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on && !needs}
        aria-label={title}
        disabled={!!needs}
        onClick={() => set(!on)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${on && !needs ? "bg-action" : "bg-strong"} disabled:cursor-not-allowed`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on && !needs ? "left-[1.375rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ---------- 1. welcome ----------
function Welcome({ user, step, onSaved }: StepProps & { user: User; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email ?? "");
  const [passkeys, setPasskeys] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  const [keyError, setKeyError] = useState("");
  const can = passkeysAvailable();
  const ok = !!name.trim() && !!username.trim() && /^\S+@\S+\.\S+$/.test(email.trim());
  useEffect(() => {
    api<unknown[]>("GET", "/api/auth/passkeys")
      .then((l) => setPasskeys(l.length))
      .catch(() => setPasskeys(0));
  }, []);
  useEffect(() => {
    step(ok, async () => {
      onSaved(await api<User>("PATCH", "/api/profile", { displayName: name.trim(), username: username.trim(), email: email.trim() }));
    });
  });
  const add = async () => {
    setKeyError("");
    try {
      await addPasskey();
      setPasskeys((n) => (n ?? 0) + 1);
    } catch (e) {
      const msg = passkeyError(e);
      if (msg) setKeyError(msg);
    }
  };
  return (
    <>
      <p className="text-subtle">
        Culury is your own recipe box and meal planner, running on your server. Save recipes from anywhere, cook from them step by step, plan the week and shop once. AI can help along the way, if you'd like it to. Let's start with you.
      </p>
      <div className="flex items-center gap-4">
        <span aria-label="Your initials" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-action text-xl font-bold text-white shadow-inner">
          {initialsOf({ ...user, displayName: name })}
        </span>
        <label className={`${label} flex-1`}>
          Your name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="First and last name" className={field} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={100} autoComplete="username" className={field} />
        </label>
        <label className={label}>
          Email address
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={field} />
        </label>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">🔑 Passkey</span>
          <button type="button" aria-label="What's a passkey?" title="What's a passkey?" aria-expanded={info} onClick={() => setInfo(!info)} className="flex size-6 items-center justify-center rounded-full border border-line text-xs font-bold text-subtle hover:bg-pressed">
            i
          </button>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${passkeys ? "bg-success-subtle text-success" : "bg-page text-subtle"}`}>{passkeys === null ? "Checking…" : passkeys ? "Passkey registered" : "No passkey yet"}</span>
        </div>
        <p className="mt-1 text-sm text-subtle">Sign in without a password, on any of your devices.</p>
        {info && (
          <p className="mt-2 rounded-lg bg-page p-3 text-sm">
            A passkey lets you sign in with Touch ID, Face ID, Windows Hello or your phone instead of typing a password. It's kept on your device (and in your password manager or iCloud Keychain, if you use one), it only works on this Culury, and it can't be guessed or tricked out of you by a fake site. Your password still works too.
          </p>
        )}
        {can ? (
          <button type="button" onClick={() => void add()} className={`${secondary} mt-3`}>
            {passkeys ? "Add another passkey" : "Add Passkey"}
          </button>
        ) : (
          <p className="mt-2 text-sm text-subtle">This browser can't add a passkey here (they need https:// or localhost). You can add one later in Settings › Security.</p>
        )}
        {keyError && <p role="alert" className="mt-2 text-sm text-error">{keyError}</p>}
      </div>
    </>
  );
}

// ---------- 2. AI ----------
type Provider = (typeof PROVIDERS)[number]["id"];
// How to get a key, provider by provider (the link is the provider's own key page)
const GUIDE: Record<Provider, ReactNode[]> = {
  local: [
    <>Install Ollama (ollama.com) or LM Studio on a computer with a graphics card.</>,
    <>
      Download a model, e.g. <code>ollama pull qwen3-vl:8b</code>.
    </>,
    <>
      Let other computers reach it (Ollama: set <code>OLLAMA_HOST=0.0.0.0</code>), then enter its address below: <code>http://&lt;that computer&gt;:11434/v1</code>.
    </>,
  ],
  openai: ["Sign in at platform.openai.com.", "Add a little credit under Billing (pay as you go).", "Create a key under API keys, and paste it below."],
  anthropic: ["Sign in at console.anthropic.com.", "Add a little credit under Billing.", "Create a key under Settings › API keys, and paste it below."],
  gemini: ["Sign in to Google AI Studio with your Google account.", "Click Create API key (there's a free tier).", "Paste it below."],
  openrouter: ["Sign in at openrouter.ai.", "Add a little credit (one key reaches many providers' models).", "Create a key under Keys, and paste it below."],
};
// Models worth starting with (Settings › AI's (i) has more); "Load models" shows what's there today
const RECOMMENDED: Record<Provider, string[]> = {
  local: ["qwen3-vl:8b", "llama3.1:8b"],
  openai: [],
  anthropic: ["claude-haiku-5-5"],
  gemini: [],
  openrouter: ["anthropic/claude-haiku-5.5"],
};
const reads = (provider: string, model: string) => provider !== "local" || /vl|vision|llava|gemma3|minicpm-v/i.test(model);

// One AI service's settings, its Test and (for hosted ones) Load models
function useService(initial: Provider) {
  const [provider, setProvider] = useState<Provider>(initial);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [tested, setTested] = useState<Result>(null);
  const [busy, setBusy] = useState("");
  const p = PROVIDERS.find((x) => x.id === provider)!;
  const body = { name: p.name, enabled: true, provider, model: model.trim(), baseUrl: provider === "local" ? baseUrl.trim() : null, apiKey: provider === "local" ? "" : apiKey.trim(), quick: true, photos: reads(provider, model) };
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setTested(null));
  const filled = !!(body.model || body.baseUrl || body.apiKey);
  const canTest = !!body.model && (provider === "local" ? !!body.baseUrl : !!body.apiKey);
  const run = async (what: "test" | "models") => {
    setBusy(what);
    try {
      if (what === "test") {
        const r = await api<{ message: string }>("POST", "/api/settings/ai/test", body);
        setTested({ ok: true, text: r.message });
      } else {
        const r = await api<{ models: string[] }>("POST", "/api/settings/ai/models", body);
        setModels(r.models);
        setTested({ ok: true, text: r.models.length ? `${r.models.length} models found: pick one in the Model box.` : "No models found." });
      }
    } catch (e) {
      setTested({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  return { provider, setProvider: changed(setProvider), p, baseUrl, setBaseUrl: changed(setBaseUrl), apiKey, setApiKey: changed(setApiKey), model, setModel: changed(setModel), models, tested, busy, run, body, filled, canTest, works: tested?.ok === true && tested.text.includes("answered") };
}
type Service = ReturnType<typeof useService>;

function ServiceFields({ s, id }: { s: Service; id: string }) {
  return (
    <>
      {s.provider === "local" ? (
        <label className={label}>
          Address
          <input value={s.baseUrl} onChange={(e) => s.setBaseUrl(e.target.value)} placeholder="http://192.168.1.20:11434/v1" className={field} />
        </label>
      ) : (
        <label className={label}>
          API key
          <input type="password" value={s.apiKey} onChange={(e) => s.setApiKey(e.target.value)} autoComplete="off" className={field} />
        </label>
      )}
      <label className={label}>
        Model
        <input value={s.model} list={`${id}-models`} onChange={(e) => s.setModel(e.target.value)} placeholder={s.provider === "local" ? "qwen3-vl:8b" : "the model's name"} className={field} />
        <datalist id={`${id}-models`}>
          {s.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {RECOMMENDED[s.provider].map((m) => (
          <button key={m} type="button" aria-label={`Use ${m}`} onClick={() => s.setModel(m)} className="rounded-full bg-brand-subtle px-3 py-1 text-xs font-semibold text-action hover:bg-active">
            ⭐ {m}
          </button>
        ))}
        {(s.provider === "local" ? !!s.baseUrl.trim() : !!s.apiKey.trim()) && (
          <button type="button" disabled={!!s.busy} onClick={() => void s.run("models")} className="text-xs font-semibold text-link hover:underline disabled:opacity-50">
            {s.busy === "models" ? "Loading…" : "Load models"}
          </button>
        )}
      </div>
      <button type="button" disabled={!!s.busy || !s.canTest} onClick={() => void s.run("test")} className={`${secondary} self-start`}>
        {s.busy === "test" ? "Testing…" : "Test Connection"}
      </button>
      <Status r={s.tested} />
    </>
  );
}

function Ai({ step }: StepProps) {
  const main = useService("local");
  const backup = useService("openrouter");
  const [withBackup, setWithBackup] = useState(false);
  const backupOk = !withBackup || !backup.filled || backup.works;
  useEffect(() =>
    step(main.works && backupOk, async () => {
      const services = [main.body, ...(withBackup && backup.works ? [{ ...backup.body, name: `${backup.p.name} (backup)` }] : [])];
      await api("PUT", "/api/settings/ai", { maxPerRun: 50, timeoutSec: 15, askNextOnNoMatch: false, services });
      forgetAiStatus();
    })
  );
  const yes = "✓";
  const rows: [string, string, string][] = [
    ["Typing in recipes", "Full support", "Full support, plus a tidy-up check"],
    ["Importing from a link", "Sites with recipe data", "Any page, even blocked sites' saved copies"],
    ["Photos and scanned PDFs", "Not available", "Reads them"],
    ["Nutrition", "Type it in", "Worked out per ingredient"],
    ["Categories and tags", "You pick them", "Suggested on import"],
    ["Discover (RSS feeds)", "Feeds and recipe previews", "Read with AI, nutrition"],
  ];
  return (
    <>
      <p className="rounded-xl bg-brand-subtle p-3 text-sm text-ink">
        <strong>AI is optional but highly recommended.</strong> It reads recipes from any page, photos and PDFs, tidies what you import, works out nutrition and helps plan meals. A home AI (like Ollama) keeps everything on your network.
      </p>
      <table aria-label="With and without AI" className="w-full overflow-hidden rounded-xl text-sm">
        <thead className="bg-page text-left text-xs uppercase tracking-wide text-subtle">
          <tr>
            <th className="px-3 py-2 font-semibold">Feature</th>
            <th className="px-3 py-2 font-semibold">Without AI</th>
            <th className="px-3 py-2 font-semibold">With AI {yes}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, without, withAi]) => (
            <tr key={f} className="border-t border-line">
              <th scope="row" className="px-3 py-2 text-left font-semibold">
                {f}
              </th>
              <td className="px-3 py-2 text-subtle">{without}</td>
              <td className="px-3 py-2">{withAi}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((x) => (
          <label key={x.id} className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border-2 px-3 py-2.5 text-sm transition ${main.provider === x.id ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
            <input type="radio" name="ai-provider" checked={main.provider === x.id} onChange={() => main.setProvider(x.id)} className="sr-only" />
            <span className="font-semibold">{x.label}</span>
            <span className="text-xs text-subtle">{x.id === "local" ? "Free and private" : x.id === "openrouter" ? "Many models, one key" : "Pay as you go"}</span>
          </label>
        ))}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <p className="text-sm font-semibold">{main.provider === "local" ? "How to set up a home AI" : "How to get a key"}</p>
        <ol aria-label="How to get a key" className="mt-2 list-decimal space-y-1 pl-5 text-sm text-subtle">
          {GUIDE[main.provider].map((g, i) => (
            <li key={i}>{g}</li>
          ))}
          {main.p.keyUrl && (
            <li>
              Key page:{" "}
              <a href={main.p.keyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline">
                {new URL(main.p.keyUrl).host} ↗
              </a>
            </li>
          )}
        </ol>
        <div className="mt-3 flex flex-col gap-3">
          <ServiceFields s={main} id="ai-main" />
        </div>
      </div>

      {!withBackup ? (
        <button type="button" onClick={() => setWithBackup(true)} className="self-start text-sm font-semibold text-link hover:underline">
          + Add a backup AI (optional)
        </button>
      ) : (
        <fieldset aria-label="Backup AI" className="flex flex-col gap-3 rounded-2xl border border-dashed border-strong p-4">
          <legend className="px-1 text-sm font-semibold">🛟 Backup AI</legend>
          <p className="-mt-1 text-sm text-subtle">Asked when the first one is down, slow, or hits its limits. A cheap hosted model makes a good backup for a home AI, and the other way round.</p>
          <label className={label}>
            Service
            <select value={backup.provider} onChange={(e) => backup.setProvider(e.target.value as Provider)} className={field}>
              {PROVIDERS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <ServiceFields s={backup} id="ai-backup" />
        </fieldset>
      )}
    </>
  );
}

// ---------- 3. fine-tune AI ----------
function AiPrefs({ step, aiOn }: StepProps & { aiOn: boolean }) {
  const [enhance, setEnhance] = useState(true);
  const [nutrition, setNutrition] = useState(true);
  const [copies, setCopies] = useState(true);
  const needs = aiOn ? undefined : "Needs AI: set it up any time in Settings › AI.";
  useEffect(() => step(true, async () => void (await api("PUT", "/api/settings/features", aiOn ? { aiEnhance: enhance, autoNutrition: nutrition, savedCopies: copies } : { savedCopies: copies }))));
  return (
    <>
      <p className="text-subtle">Choose where AI lends a hand. You can change any of these later in Settings.</p>
      <Switch on={enhance} set={setEnhance} needs={needs} title="Improve with AI" hint="After you add a recipe, AI checks it: tidies the ingredients, fills gaps in the steps, and suggests categories and tags. You accept or reject each change." />
      <Switch on={nutrition} set={setNutrition} needs={needs} title="Auto nutrition" hint="Works out each recipe's nutrition one ingredient at a time, and again when the ingredients change." />
      <Switch on={copies} set={setCopies} title="Saved copies for blocked sites" hint="When a site won't let Culury read a recipe (a security check or a paywall), look for a saved copy of the page in a web archive. Reading a copy without recipe data needs AI." />
    </>
  );
}

// ---------- 4. email ----------

function Section({ title, intro, open, setOpen, children }: { title: string; intro: string; open: boolean; setOpen: (v: boolean) => void; children: ReactNode }) {
  return (
    <fieldset aria-label={title} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <legend className="px-1 font-semibold">{title}</legend>
      <p className="-mt-1 text-sm text-subtle">{intro}</p>
      {open ? (
        children
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`${secondary} self-start`}>
          Set it up
        </button>
      )}
    </fieldset>
  );
}

function Email({ user, step }: StepProps & { user: User }) {
  // in: a mailbox Culury checks
  const [inOpen, setInOpen] = useState(false);
  const [inPreset, setInPreset] = useState("gmail");
  const inP = IMAP.find((p) => p.id === inPreset);
  const [inHost, setInHost] = useState("");
  const [inPort, setInPort] = useState("993");
  const [inSecure, setInSecure] = useState(true);
  const [inUser, setInUser] = useState("");
  const [inPass, setInPass] = useState("");
  const [allowed, setAllowed] = useState(user.email ?? "");
  const [inTested, setInTested] = useState<Result>(null);
  // out: Culury sends email
  const [outOpen, setOutOpen] = useState(false);
  const [outPreset, setOutPreset] = useState("gmail");
  const outP = PRESETS.find((p) => p.id === outPreset);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [appUrl, setAppUrl] = useState(window.location.origin);
  const [outTested, setOutTested] = useState<Result>(null);
  const [busy, setBusy] = useState("");
  const [manual, setManual] = useState(false);

  const capture = { enabled: true, host: inP?.host ?? inHost.trim(), port: inP ? 993 : Number(inPort), secure: inP ? true : inSecure, username: inUser.trim(), password: inPass, mailbox: "INBOX", allowedSenders: allowed.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) };
  const sending = { enabled: true, host: outP?.host ?? host.trim(), port: outP?.port ?? Number(port), security: outP?.security ?? (Number(port) === 465 ? "ssl" : "starttls"), username: username.trim(), password, fromName: "Culury", fromAddress: from.trim(), appUrl: appUrl.trim() };
  const inFilled = inOpen && !!(capture.username || capture.password || (!inP && capture.host));
  const outFilled = outOpen && !!(sending.username || sending.password || sending.fromAddress || (!outP && sending.host));
  const inOk = !inFilled || !!inTested?.ok;
  const outOk = !outFilled || !!outTested?.ok;
  const inChanged = <T,>(set: (v: T) => void) => (v: T) => (set(v), setInTested(null));
  const outChanged = <T,>(set: (v: T) => void) => (v: T) => (set(v), setOutTested(null));
  useEffect(() =>
    step(inOk && outOk, async () => {
      if (inFilled) await api("PUT", "/api/settings/mail-capture", capture);
      if (outFilled) await api("PUT", "/api/settings/email", sending);
    })
  );
  const test = async (which: "in" | "out") => {
    setBusy(which);
    try {
      if (which === "in") setInTested({ ok: true, text: (await api<{ message: string }>("POST", "/api/settings/mail-capture/test", capture)).message });
      else setOutTested({ ok: true, text: (await api<{ message: string }>("POST", "/api/settings/email/test", { settings: sending, ...(user.email ? { to: user.email } : {}) })).message });
    } catch (e) {
      (which === "in" ? setInTested : setOutTested)({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };

  return (
    <>
      <p className="text-subtle">Both are optional, and you can set them up later in Settings › Email.</p>
      <Section title="Send recipes to Culury by email" intro="Forward a recipe email or a link to a mailbox Culury checks every few minutes. Links land in your Inbox, and a recipe written in an email lands as a note you can import with one click." open={inOpen} setOpen={setInOpen}>
        <label className={label}>
          Provider
          <select value={inPreset} onChange={(e) => inChanged(setInPreset)(e.target.value)} className={field}>
            {IMAP.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Another mail server (IMAP)</option>
          </select>
        </label>
        {inP && <p className="-mt-2 text-sm text-subtle">{inP.hint}</p>}
        {!inP && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <label className={label}>
              IMAP server
              <input value={inHost} onChange={(e) => inChanged(setInHost)(e.target.value)} placeholder="imap.example.com" className={field} />
            </label>
            <label className={label}>
              Port
              <input value={inPort} inputMode="numeric" onChange={(e) => (inChanged(setInPort)(e.target.value), setInSecure(e.target.value !== "143"))} className={field} />
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Email address
            <input value={inUser} onChange={(e) => inChanged(setInUser)(e.target.value)} placeholder="recipes@gmail.com" autoComplete="off" className={field} />
          </label>
          <label className={label}>
            App password
            <input type="password" value={inPass} onChange={(e) => inChanged(setInPass)(e.target.value)} autoComplete="new-password" className={field} />
          </label>
        </div>
        <div>
          <label className={label}>
            Only from
            <input value={allowed} onChange={(e) => inChanged(setAllowed)(e.target.value)} aria-describedby="only-from-hint" placeholder="you@example.com, @yourfamily.com" className={field} />
          </label>
          <span id="only-from-hint" className="mt-1 block text-xs text-muted">
            Addresses (or @a-whole-domain) whose emails come in. Leave it empty to take email from anyone.
          </span>
        </div>
        <button type="button" disabled={!!busy || !capture.host || !capture.username || !capture.password} onClick={() => void test("in")} className={`${secondary} self-start`}>
          {busy === "in" ? "Connecting…" : "Test the mailbox"}
        </button>
        <Status r={inTested} />
      </Section>

      <Section title="Let Culury send email" intro="For password resets, shared recipes, grocery lists and meal plan reminders. A test email has to arrive before it's saved." open={outOpen} setOpen={setOutOpen}>
        <label className={label}>
          Provider
          <select value={outPreset} onChange={(e) => outChanged(setOutPreset)(e.target.value)} className={field}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Another server</option>
          </select>
        </label>
        {outP && <p className="-mt-2 text-sm text-subtle">{outP.hint}</p>}
        {!outP && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <label className={label}>
              Server
              <input value={host} onChange={(e) => outChanged(setHost)(e.target.value)} placeholder="smtp.example.com" className={field} />
            </label>
            <label className={label}>
              Port
              <input value={port} inputMode="numeric" onChange={(e) => outChanged(setPort)(e.target.value)} className={field} />
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Username
            <input value={username} onChange={(e) => outChanged(setUsername)(e.target.value)} autoComplete="off" className={field} />
          </label>
          <label className={label}>
            Password
            <input type="password" value={password} onChange={(e) => outChanged(setPassword)(e.target.value)} autoComplete="new-password" className={field} />
          </label>
        </div>
        <label className={label}>
          From address
          <input type="email" value={from} onChange={(e) => outChanged(setFrom)(e.target.value)} placeholder="recipes@example.com" className={field} />
        </label>
        <div>
          <label className={label}>
            Culury's address
            <input value={appUrl} onChange={(e) => outChanged(setAppUrl)(e.target.value)} aria-describedby="app-url-hint" className={field} />
          </label>
          <span id="app-url-hint" className="mt-1 block text-xs text-muted">
            Used for links in emails, like Open the recipe. Use the address people reach Culury on.
          </span>
        </div>
        <button type="button" disabled={!!busy || !sending.host || !sending.fromAddress} onClick={() => void test("out")} className={`${secondary} self-start`}>
          {busy === "out" ? "Sending…" : "Send a test email"}
        </button>
        <Status r={outTested} />
      </Section>

      <div className="rounded-xl bg-page">
        <button type="button" aria-expanded={manual} onClick={() => setManual(!manual)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold">
          Manual setup details
          <span aria-hidden>{manual ? "▴" : "▾"}</span>
        </button>
        {manual && (
          <div className="space-y-2 px-3 pb-3 text-sm text-subtle">
            <p>
              <strong>Receiving (IMAP):</strong> port 993 with SSL/TLS (most providers), or 143 with STARTTLS. Culury reads unread emails in the Inbox folder and marks each one read.
            </p>
            <p>
              <strong>Sending (SMTP):</strong> port 587 with STARTTLS, or 465 with SSL/TLS.
            </p>
            <p>
              <strong>Passwords:</strong> Gmail, iCloud and Outlook with two-step sign-in need an app password, made in your account's security settings. Culury keeps it encrypted.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- 5. recipe & meal planning ----------
function Prefs({ user, owner, step }: StepProps & { user: User; owner: boolean }) {
  const [units, setUnits] = useState<string>(user.units ?? "original");
  const [awake, setAwake] = useState(user.keepAwake ?? true);
  const [feeds, setFeeds] = useState(true);
  useEffect(() =>
    step(true, async () => {
      await api("PATCH", "/api/profile", { units, keepAwake: awake });
      if (owner) await api("PUT", "/api/settings/features", { discoveryRefresh: feeds });
    })
  );
  const choice = (value: string, title: string, hint: string) => (
    <label className={`flex cursor-pointer flex-col rounded-xl border-2 px-3 py-2.5 ${units === value ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
      <input type="radio" name="units" aria-label={`${title}: ${hint}`} checked={units === value} onChange={() => setUnits(value)} className="sr-only" />
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-subtle">{hint}</span>
    </label>
  );
  return (
    <>
      <div>
        <p className="font-semibold">📏 Measurements</p>
        <p className="text-sm text-subtle">How amounts show when you open a recipe. Every recipe also has a switch, and serving sizes scale the amounts on any recipe.</p>
        <div role="radiogroup" aria-label="Measurements" className="mt-2 grid grid-cols-3 gap-2">
          {choice("original", "As is", "The way it was written")}
          {choice("metric", "Metric", "Grams, millilitres, °C")}
          {choice("us", "US", "Cups, ounces, °F")}
        </div>
      </div>
      <Switch on={awake} set={setAwake} title="Keep the screen awake in Cook mode" hint="While you cook from a recipe step by step, ticking off ingredients and steps, your phone or tablet won't go to sleep." />
      {owner && <Switch on={feeds} set={setFeeds} title="Check feeds by themselves" hint="Discover checks the recipe sites you follow every few hours for new recipes. Off: only when you press Refresh." />}
    </>
  );
}

// ---------- 6. done ----------
function Done({ step }: StepProps) {
  useEffect(() => step(true, async () => {}));
  return (
    <>
      <p className="text-subtle">Culury is ready for your recipes. Two things to make it even easier:</p>
      <div className="flex flex-col gap-2 rounded-2xl bg-gradient-to-br from-brand-subtle to-[#fff6e0] p-4">
        <p className="font-semibold">🧩 The Culury Companion browser extension</p>
        <p className="text-sm text-subtle">Clip a recipe from any site in one click, straight into Culury or your Inbox. It works in Chrome, Brave and Edge.</p>
        <a href={COMPANION} target="_blank" rel="noopener noreferrer" className="self-start rounded-lg bg-container px-4 py-2 text-sm font-semibold text-action shadow-sm hover:bg-pressed">
          Get the Culury Companion on GitHub ↗
        </a>
      </div>
      <Note>
        👉 To import your first recipe by hand or from a link, click Add recipe at the top right of your recipes, any time. We'll point it out for you.
      </Note>
    </>
  );
}
