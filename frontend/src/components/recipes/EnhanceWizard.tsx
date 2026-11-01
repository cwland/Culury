import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, getToken } from "../../api";
import { Popup } from "../Popup";
import { Check, ChevronRight } from "../Icons";
import { stepLabel, type Enhancement, type Nutrition, type Recipe } from "../../recipes";

// One line of the progress list from the server
type Skip = { id: string; name: string };
type Progress = { text: string; waiting?: boolean; at: number; detail?: string; skip?: Skip };
type StepEvent = { text: string; waiting?: boolean; skip?: Skip };

// Ask for the check with progress: the server sends one JSON object per line as it works
// ({"type":"step",...}, then {"type":"result",...} or {"type":"error",...}). A plain JSON reply works too.
async function checkRecipe(id: number, on: { step: (p: StepEvent) => void; status: (text: string) => void }, o: { skip: string[]; signal: AbortSignal }): Promise<Enhancement> {
  const token = getToken();
  let res: Response;
  try {
    const query = o.skip.length ? `?skip=${o.skip.map(encodeURIComponent).join(",")}` : "";
    res = await fetch(`/api/recipes/${id}/enhance${query}`, { method: "POST", signal: o.signal, headers: { accept: "application/x-ndjson, application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  } catch {
    throw new ApiError(0, "Couldn't reach Culury. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `The AI check failed (${res.status})`);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson")) return (await res.json()) as Enhancement;
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.type === "step") on.step({ text: o.text, waiting: o.waiting, skip: o.skip });
      else if (o.type === "status") on.status(o.text);
      else if (o.type === "result") return o.enhancement as Enhancement;
      else if (o.type === "error") throw new ApiError(o.status ?? 500, o.error ?? "The AI check failed");
    }
    if (done) throw new ApiError(0, "The connection closed before the AI finished. Try again.");
  }
}

// What the AI was asked to look for (shown in turn while it works; these are its instructions, not progress)
const ASKED = [
  "look for missing times, temperatures and doneness cues",
  "expand brief steps into full instructions",
  "check that the steps use every ingredient",
  "find ingredients the steps use but the list leaves out",
  "check doneness temperatures are food-safe",
  "estimate nutrition per serving",
  "match your categories and suggest tags",
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// collapsed: the check is done and the suggestions are showing; a > opens the list again
function ProgressList({ lines, working, onSkip, collapsed }: { lines: Progress[]; working: boolean; onSkip: (s: Skip) => void; collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tip, setTip] = useState(0);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const r = setInterval(() => setTip((i) => (i + 1) % ASKED.length), 3500);
    return () => (clearInterval(t), clearInterval(r));
  }, [working]);
  if (collapsed && !open)
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-sm font-semibold text-subtle hover:text-ink">
        <ChevronRight className="size-4" /> What the AI did ({lines.length} steps)
      </button>
    );
  return (
    <div className="rounded-xl bg-page p-4">
      {collapsed && (
        <button type="button" aria-expanded={true} onClick={() => setOpen(false)} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-subtle hover:text-ink">
          <ChevronRight className="size-4 rotate-90" /> What the AI did ({lines.length} steps)
        </button>
      )}
      <ul role="log" aria-label="AI check progress" className="space-y-1.5 text-sm">
        {lines.map((l, i) => {
          const active = working && i === lines.length - 1;
          const next = lines[i + 1];
          // a finished wait: "Asked Home AI (qwen3-vl:32b)", took 0:42
          const text = !active && l.waiting ? l.text.replace(/^Asking (.*)…$/, "Asked $1") : l.text;
          return (
            <li key={i} className="flex items-start gap-2">
              {active ? <span className="mt-1 size-3 shrink-0 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-action" />}
              <span className={active ? "font-semibold" : "text-subtle"}>
                {text}
                {active && l.detail && <span className="block text-xs font-normal text-muted">{l.detail}</span>}
              </span>
              {active && l.waiting && <span className="ml-auto tabular-nums text-muted">{clock(Math.max(0, Math.floor((now - l.at) / 1000)))}</span>}
              {!active && l.waiting && next && <span className="ml-auto tabular-nums text-muted">took {clock(Math.max(0, Math.round((next.at - l.at) / 1000)))}</span>}
              {active && l.skip && (
                <button type="button" onClick={() => onSkip(l.skip!)} className="shrink-0 rounded-md border border-line bg-container px-2 py-0.5 text-xs font-semibold hover:bg-pressed">
                  Skip {l.skip.name}
                </button>
              )}
            </li>
          );
        })}
        {working && !lines.length && <li className="text-subtle">Starting the check…</li>}
      </ul>
      {working && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
          The AI was asked to {ASKED[tip]}. A full check usually takes 10 seconds to a couple of minutes on a home AI.
        </p>
      )}
    </div>
  );
}

type Key = "steps" | "ingredients" | "nutrition" | "organize";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const stepLines = (r: Recipe) => r.steps.map((s) => (s.section ? `# ${s.section}` : s.text));
const ingredientLines = (r: Recipe) => r.ingredients.map((i) => (i.section ? `# ${i.section}` : i.raw));

// One line of a list; "# Heading" lines show as headings. Lines that aren't in the original are marked.
function Line({ text, marked }: { text: string; marked?: boolean }) {
  const heading = text.match(/^#\s+(.+)$/)?.[1];
  const label = heading ? null : stepLabel(text);
  const body = heading ? (
    <strong>{heading}</strong>
  ) : label ? (
    <>
      <strong>{label[0]}</strong>
      {label[1]}
    </>
  ) : (
    text
  );
  return <li className="py-0.5">{marked ? <mark className="rounded bg-action/15 px-0.5 text-ink">{body}</mark> : body}</li>;
}
function Lines({ lines, against }: { lines: string[]; against?: string[] }) {
  const before = against && new Set(against.map(norm));
  if (!lines.length) return <p className="text-subtle">None</p>;
  return (
    <ul className="space-y-0.5">
      {lines.map((l, i) => (
        <Line key={i} text={l} marked={!!before && !before.has(norm(l))} />
      ))}
    </ul>
  );
}

const NUTRIENTS: [keyof Nutrition, string, string][] = [
  ["calories", "Calories", "kcal"],
  ["fat", "Fat", "g"],
  ["saturatedFat", "Saturated fat", "g"],
  ["carbs", "Carbs", "g"],
  ["fiber", "Fiber", "g"],
  ["sugar", "Sugar", "g"],
  ["addedSugar", "Added sugars", "g"],
  ["protein", "Protein", "g"],
  ["sodium", "Sodium", "mg"],
];
function NutritionList({ n }: { n: Nutrition | null }) {
  if (!n) return <p className="text-subtle">None yet</p>;
  return (
    <dl className="grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5">
      {n.servingSize && (
        <div className="contents">
          <dt className="text-subtle">Serving size</dt>
          <dd>{n.servingSize}</dd>
        </div>
      )}
      {NUTRIENTS.map(([k, label, unit]) => (
        <div key={k} className="contents">
          <dt className="text-subtle">{label}</dt>
          <dd>{n[k] == null ? "–" : `${n[k]} ${unit}`}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items, mark, strike, isNew }: { items: string[]; mark?: Set<string>; strike?: Set<string>; isNew?: Set<string> }) {
  if (!items.length) return <span className="text-subtle">None</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((x) => {
        const k = x.toLowerCase();
        const label = strike?.has(k) ? <s>{x}</s> : mark?.has(k) ? <mark className="rounded bg-action/15 px-0.5 text-ink">{x}</mark> : x;
        return (
          <span key={x} className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5">
            {label}
            {isNew?.has(k) && <span className="rounded bg-action px-1 text-xs font-semibold text-white">new</span>}
          </span>
        );
      })}
    </span>
  );
}

// One part of the recipe: Original on the left, AI suggestion on the right (stacked on a phone),
// what changed, and the choice: the AI's version or the original
function Part({ title, badge, changes, use, onUse, original, suggested }: { title: string; badge?: string; changes: string[]; use: boolean; onUse: (v: boolean) => void; original: ReactNode; suggested: ReactNode }) {
  const choice = (on: boolean, label: string) => (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-medium ${use === on ? "border-action bg-brand-subtle" : "border-line hover:bg-page"}`}>
      <input type="radio" name={`use-${title}`} checked={use === on} onChange={() => onUse(on)} className="size-4 accent-[var(--color-action)]" />
      {label}
    </label>
  );
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xl font-bold">
        {title}
        {badge && <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-action">{badge}</span>}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-subtle">Original</h4>
          {original}
        </div>
        <div className="rounded-xl border border-action/40 p-3">
          <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-subtle">AI suggestion</h4>
          {suggested}
        </div>
      </div>
      {changes.length > 0 && (
        <div className="rounded-lg bg-page p-3">
          <p className="text-sm font-semibold">What changed</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {choice(true, "Use the AI's version")}
        {choice(false, "Keep the original")}
      </div>
    </section>
  );
}

// Improve with AI: asks the AI to check the recipe (nothing is saved yet), then goes one part at a
// time (ingredients, instructions, nutrition, categories and tags: only parts with changes), each
// with the original beside the AI's version, and ends on a summary with Save. Only the parts you
// keep the AI's version of are saved; what the recipe was stays in the version history.
// position and onStop: reviewing an import's recipes one by one ("Recipe 3 of 42", Stop reviewing)
export default function EnhanceWizard({ recipe, onClose, onApplied, position, onStop }: { recipe: Recipe; onClose: () => void; onApplied: (r: Recipe) => void; position?: { n: number; of: number }; onStop?: () => void }) {
  const [e, setE] = useState<Enhancement | null>(null);
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState<Record<Key, boolean>>({ steps: false, ingredients: false, nutrition: false, organize: false });
  const [at, setAt] = useState(0); // which screen

  const [lines, setLines] = useState<Progress[]>([]);
  const [errorStatus, setErrorStatus] = useState(0);
  const run = useRef(0);
  const stopper = useRef<AbortController | null>(null);
  // skip: services the person skipped as too slow (asked again without them; the list carries on)
  const check = useCallback(
    (skip: string[] = []) => {
      const mine = ++run.current; // a newer request wins over an older answer
      stopper.current?.abort();
      const stop = (stopper.current = new AbortController());
      setError("");
      setE(null);
      if (!skip.length) setLines([]);
      checkRecipe(
        recipe.id,
        {
          step: (p) =>
            mine === run.current &&
            setLines((ls) => (skip.length && /^Reading “/.test(p.text) && ls.some((l) => /^Reading “/.test(l.text)) ? ls : [...ls, { ...p, at: Date.now() }])),
          status: (text) => mine === run.current && setLines((ls) => (ls.length ? [...ls.slice(0, -1), { ...ls[ls.length - 1], detail: text }] : ls)),
        },
        { skip, signal: stop.signal }
      )
        .then((r) => {
          if (mine !== run.current) return;
          setE(r);
          setAt(0);
          setUse({ steps: r.steps.changed, ingredients: r.ingredients.changed, nutrition: r.nutrition.changed, organize: r.organize.changed });
        })
        .catch((err) => {
          if (mine !== run.current) return;
          setErrorStatus((err as ApiError).status ?? 0);
          setError((err as Error).message);
        });
    },
    [recipe.id]
  );
  const skipped = useRef<string[]>([]);
  const skipService = (s: Skip) => {
    skipped.current = [...skipped.current, s.id];
    setLines((ls) => [...ls.map((l) => ({ ...l, skip: undefined, detail: undefined })), { text: `Skipped ${s.name}`, at: Date.now() }]);
    check(skipped.current);
  };
  // closing the window stops the request (the AI server stops working on it too)
  useEffect(() => () => stopper.current?.abort(), []);
  useEffect(() => {
    skipped.current = [];
    check();
  }, [check]);

  async function apply() {
    if (!e) return;
    setBusy(true);
    setApplyError("");
    const body: Record<string, unknown> = {};
    if (use.steps && e.steps.changed) body.steps = e.steps.suggested;
    if (use.ingredients && e.ingredients.changed) body.ingredients = e.ingredients.suggested;
    if (use.nutrition && e.nutrition.changed) body.nutrition = e.nutrition.suggested;
    if (use.organize && e.organize.changed) Object.assign(body, { categories: e.organize.categories, tags: e.organize.tags });
    try {
      onApplied(await api<Recipe>("POST", `/api/recipes/${recipe.id}/enhance/apply`, body));
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cats = recipe.categories.map((c) => c.name);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  // The screens: each part with changes, in this order, then Save
  const parts: { key: Key; title: string; screen: () => ReactNode }[] = !e
    ? []
    : ([
        {
          key: "ingredients",
          title: "Ingredients",
          screen: () => <Part title="Ingredients" changes={e.ingredients.changes} use={use.ingredients} onUse={(v) => setUse({ ...use, ingredients: v })} original={<Lines lines={ingredientLines(recipe)} />} suggested={<Lines lines={e.ingredients.suggested} against={ingredientLines(recipe)} />} />,
        },
        {
          key: "steps",
          title: "Instructions",
          screen: () => (
            <Part
              title="Instructions"
              badge={e.steps.mode === "expanded" ? "Expanded" : e.steps.mode === "filled" ? "Filled gaps" : undefined}
              changes={e.steps.changes}
              use={use.steps}
              onUse={(v) => setUse({ ...use, steps: v })}
              original={<Lines lines={stepLines(recipe)} />}
              suggested={<Lines lines={e.steps.suggested} against={stepLines(recipe)} />}
            />
          ),
        },
        {
          key: "nutrition",
          title: "Nutrition",
          screen: () => <Part title="Nutrition" changes={e.nutrition.changes} use={use.nutrition} onUse={(v) => setUse({ ...use, nutrition: v })} original={<NutritionList n={recipe.nutrition} />} suggested={<NutritionList n={e.nutrition.suggested} />} />,
        },
        {
          key: "organize",
          title: "Categories and tags",
          screen: () => (
            <Part
              title="Categories and tags"
              changes={e.organize.changes}
              use={use.organize}
              onUse={(v) => setUse({ ...use, organize: v })}
              original={
                <div className="space-y-2">
                  <p className="text-sm text-subtle">Categories</p>
                  <Chips items={cats} />
                  <p className="text-sm text-subtle">Tags</p>
                  <Chips items={recipe.tags} strike={new Set([...lower(recipe.tags)].filter((t) => !lower(e.organize.tags).has(t)))} />
                </div>
              }
              suggested={
                <div className="space-y-2">
                  <p className="text-sm text-subtle">Categories</p>
                  <Chips items={e.organize.categories} mark={new Set([...lower(e.organize.categories)].filter((c) => !lower(cats).has(c)))} isNew={lower(e.organize.newCategories)} />
                  <p className="text-sm text-subtle">Tags</p>
                  <Chips items={e.organize.tags} mark={new Set([...lower(e.organize.tags)].filter((t) => !lower(recipe.tags).has(t)))} />
                </div>
              }
            />
          ),
        },
      ] as const).filter((p) => e[p.key].changed);
  const total = parts.length + 1; // (+ the Save screen)
  const onSave = !!e && at >= parts.length;
  const anyTicked = parts.some((p) => use[p.key]);
  const button = "rounded-lg px-4 py-2 font-semibold";

  return (
    <Popup title={recipe.title} onClose={onClose} wide tall>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        {e && parts.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-action">
              {position ? `Recipe ${position.n} of ${position.of} · ` : ""}Improve with AI · Step {Math.min(at, parts.length) + 1} of {total}
            </p>
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-action" : "bg-line"}`} />
              ))}
            </div>
          </div>
        )}
        {(lines.length > 0 || (!e && !error)) && <ProgressList lines={lines} working={!e && !error} onSkip={skipService} collapsed={!!e} />}
        {error && (
          <div role="alert" className="rounded-xl bg-error-subtle p-4">
            <p>{error}</p>
            {/* AI Enhance or AI turned off, or the recipe is gone: asking again won't help */}
            {errorStatus !== 409 && errorStatus !== 404 && (
              <button type="button" onClick={() => check(skipped.current)} className="mt-3 rounded-lg bg-action px-4 py-2 font-semibold text-white hover:opacity-90">
                Try again
              </button>
            )}
          </div>
        )}
        {e && parts.length === 0 && (
          <>
            <p className="rounded-xl bg-page p-4">The AI didn't find anything to change. The recipe looks good as it is.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={`${button} bg-action text-white hover:opacity-90`}>
                Done
              </button>
            </div>
          </>
        )}
        {e && parts.length > 0 && (
          <>
            {!onSave && parts[at].screen()}
            {onSave && (
              <section aria-label="Save" className="flex flex-col gap-3">
                <h3 className="text-xl font-bold">Save</h3>
                <ul aria-label="Your choices" className="divide-y divide-line rounded-xl border border-line">
                  {parts.map((p, i) => (
                    <li key={p.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="font-semibold">{p.title}</span>
                      <button type="button" onClick={() => setAt(i)} className="text-sm text-link hover:underline">
                        {use[p.key] ? "AI's version" : "Original"}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-subtle">The recipe as it is now stays in Version history.</p>
                {applyError && (
                  <p role="alert" className="rounded-xl bg-error-subtle p-3">
                    {applyError}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-3">
                  {!anyTicked && (
                    <button type="button" onClick={onClose} className={`${button} border border-line hover:bg-page`}>
                      Close without changes
                    </button>
                  )}
                  <button type="button" onClick={apply} disabled={busy || !anyTicked} className={`${button} bg-action text-white hover:opacity-90 disabled:opacity-50`}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </section>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="button" onClick={onClose} className="px-2 py-2 font-semibold text-subtle hover:underline">
                Skip
              </button>
              {onStop && (
                <button type="button" onClick={onStop} className="px-2 py-2 font-semibold text-subtle hover:underline">
                  Stop reviewing
                </button>
              )}
              <span className="ml-auto" />
              {at > 0 && (
                <button type="button" onClick={() => setAt(at - 1)} className={`${button} border border-line hover:bg-page`}>
                  Back
                </button>
              )}
              {!onSave ? (
                <button type="button" onClick={() => setAt(at + 1)} className={`${button} bg-action text-white hover:opacity-90`}>
                  Next
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Popup>
  );
}
