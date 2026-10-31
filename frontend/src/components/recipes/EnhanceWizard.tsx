import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { Popup } from "../Popup";
import type { Enhancement, Nutrition, Recipe } from "../../recipes";

type Key = "steps" | "ingredients" | "nutrition" | "organize";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const stepLines = (r: Recipe) => r.steps.map((s) => (s.section ? `# ${s.section}` : s.text));
const ingredientLines = (r: Recipe) => r.ingredients.map((i) => (i.section ? `# ${i.section}` : i.raw));

// One line of a list; "# Heading" lines show as headings. Lines that aren't in the original are marked.
function Line({ text, marked }: { text: string; marked?: boolean }) {
  const heading = text.match(/^#\s+(.+)$/)?.[1];
  const body = heading ? <strong>{heading}</strong> : text;
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
  ["protein", "Protein", "g"],
  ["sodium", "Sodium", "mg"],
];
function NutritionList({ n }: { n: Nutrition | null }) {
  if (!n) return <p className="text-subtle">None yet</p>;
  return (
    <dl className="grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5">
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

// One section: Original on the left, AI suggestion on the right (stacked on a phone)
function Part({ title, changed, changes, use, onUse, original, suggested }: { title: string; changed: boolean; changes: string[]; use: boolean; onUse: (v: boolean) => void; original: ReactNode; suggested: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        {changed ? (
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input type="checkbox" checked={use} onChange={(e) => onUse(e.target.checked)} className="size-5 accent-[var(--color-action)]" />
            Use this
          </label>
        ) : (
          <span className="text-subtle">No changes</span>
        )}
      </div>
      {changed && (
        <>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-subtle">Original</h4>
              {original}
            </div>
            <div>
              <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-subtle">AI suggestion</h4>
              {suggested}
            </div>
          </div>
          {changes.length > 0 && (
            <div className="mt-3 rounded-lg bg-page p-3">
              <p className="text-sm font-semibold">What changed</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// AI Enhance: asks the AI to check the recipe (nothing is saved), shows each section side by side,
// and saves only the sections you keep. The recipe page offers Undo AI changes afterwards.
export default function EnhanceWizard({ recipe, onClose, onApplied }: { recipe: Recipe; onClose: () => void; onApplied: (r: Recipe) => void }) {
  const [e, setE] = useState<Enhancement | null>(null);
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState<Record<Key, boolean>>({ steps: false, ingredients: false, nutrition: false, organize: false });

  const check = useCallback(() => {
    setError("");
    setE(null);
    api<Enhancement>("POST", `/api/recipes/${recipe.id}/enhance`)
      .then((r) => {
        setE(r);
        setUse({ steps: r.steps.changed, ingredients: r.ingredients.changed, nutrition: r.nutrition.changed, organize: r.organize.changed });
      })
      .catch((err) => setError((err as Error).message));
  }, [recipe.id]);
  useEffect(check, [check]);

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

  const anyChange = !!e && (e.steps.changed || e.ingredients.changed || e.nutrition.changed || e.organize.changed);
  const anyTicked = !!e && (["steps", "ingredients", "nutrition", "organize"] as Key[]).some((k) => use[k] && e[k].changed);
  const cats = recipe.categories.map((c) => c.name);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

  return (
    <Popup title="AI check" onClose={onClose} wide tall>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        {!e && !error && (
          <p role="status" className="py-10 text-center text-subtle">
            Checking the recipe… This usually takes 10 to 30 seconds.
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl bg-error-subtle p-4">
            <p>{error}</p>
            <button type="button" onClick={check} className="mt-3 rounded-lg bg-action px-4 py-2 font-semibold text-white hover:opacity-90">
              Try again
            </button>
          </div>
        )}
        {e && (
          <>
            {!anyChange && <p className="rounded-xl bg-page p-4">The AI didn't find anything to change. The recipe looks good as it is.</p>}
            <Part
              title="Instructions"
              {...e.steps}
              use={use.steps}
              onUse={(v) => setUse({ ...use, steps: v })}
              original={<Lines lines={stepLines(recipe)} />}
              suggested={<Lines lines={e.steps.suggested} against={stepLines(recipe)} />}
            />
            <Part
              title="Ingredients"
              {...e.ingredients}
              use={use.ingredients}
              onUse={(v) => setUse({ ...use, ingredients: v })}
              original={<Lines lines={ingredientLines(recipe)} />}
              suggested={<Lines lines={e.ingredients.suggested} against={ingredientLines(recipe)} />}
            />
            <Part
              title="Nutrition"
              {...e.nutrition}
              use={use.nutrition}
              onUse={(v) => setUse({ ...use, nutrition: v })}
              original={<NutritionList n={recipe.nutrition} />}
              suggested={<NutritionList n={e.nutrition.suggested} />}
            />
            <Part
              title="Categories and tags"
              {...e.organize}
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
            {applyError && (
              <p role="alert" className="rounded-xl bg-error-subtle p-3">
                {applyError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 font-semibold hover:bg-page">
                Keep original
              </button>
              {anyChange && (
                <button type="button" onClick={apply} disabled={busy || !anyTicked} className="rounded-lg bg-action px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? "Applying…" : "Apply selected"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Popup>
  );
}
