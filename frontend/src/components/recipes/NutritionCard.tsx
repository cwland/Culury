import { useState } from "react";
import { api } from "../../api";
import { useAiStatus } from "../../ai";
import { pointsEstimate, type Nutrition } from "../../recipes";
import { Popup } from "../Popup";
import { EditIcon, WandIcon } from "../Icons";

const iconButton = "flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink disabled:opacity-60";

// Daily values used on US nutrition labels
const ROWS: { key: keyof Nutrition; label: string; unit: string; dv?: number; indent?: boolean }[] = [
  { key: "fat", label: "Total fat", unit: "g", dv: 78 },
  { key: "saturatedFat", label: "Saturated fat", unit: "g", dv: 20, indent: true },
  { key: "sodium", label: "Sodium", unit: "mg", dv: 2300 },
  { key: "carbs", label: "Total carbohydrate", unit: "g", dv: 275 },
  { key: "fiber", label: "Dietary fiber", unit: "g", dv: 28, indent: true },
  { key: "sugar", label: "Total sugars", unit: "g", indent: true },
  { key: "addedSugar", label: "Added sugars", unit: "g", dv: 50, indent: true },
  { key: "protein", label: "Protein", unit: "g", dv: 50 },
];
const SOURCE = { site: "From the recipe's site", ai: "Estimated by AI", you: "Entered by you" };
const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

export function NutritionCard({ recipeId, servings, value, updating, onChange }: { recipeId: number; servings: number | null; value: Nutrition | null; updating?: boolean; onChange: (n: Nutrition | null) => void }) {
  const ai = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const estimate = async () => {
    setBusy(true);
    setError("");
    try {
      onChange(await api<Nutrition>("POST", `/api/recipes/${recipeId}/nutrition`));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const points = value ? pointsEstimate(value) : null;
  const stale = value?.servings && servings && value.servings !== servings;

  return (
    <section aria-label="Nutrition" className="rounded-2xl bg-container p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">Nutrition</h2>
        {value && <span className="mr-auto text-sm text-subtle">per serving</span>}
        {value && (
          <div role="toolbar" aria-label="Nutrition actions" className="ml-auto flex items-center gap-1">
            {ai.ready && (
              <button type="button" aria-label="Re-analyze with AI" title="Re-analyze with AI" onClick={() => void estimate()} disabled={busy} className={iconButton}>
                <WandIcon className={`size-4 ${busy ? "animate-pulse" : ""}`} />
              </button>
            )}
            <button type="button" aria-label="Edit nutrition" title="Edit nutrition" onClick={() => setEditing(true)} className={iconButton}>
              <EditIcon />
            </button>
          </div>
        )}
      </div>
      {busy && value && (
        <p role="status" className="mt-2 text-sm font-semibold text-action">
          Working it out…
        </p>
      )}
      {updating && (
        <p role="status" className="mt-2 text-sm font-semibold text-action">
          Updating nutrition…
        </p>
      )}
      {!value ? (
        updating ? null : (
        <>
          <p className="mt-2 text-subtle">No nutrition facts yet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ai.ready && (
              <button type="button" onClick={() => void estimate()} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "Working it out…" : "Estimate with AI"}
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-pressed">
              Type it in
            </button>
          </div>
        </>
        )
      ) : (
        <>
          {value.outdated && (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">
              The ingredients changed since these numbers were {value.source === "you" ? "entered" : "worked out"}. {ai.ready ? "Re-analyze them with AI, or edit them (the buttons at the top)." : "Edit them to match (the pencil at the top)."}
            </p>
          )}
          <NutritionFacts value={value} />
          <p className="mt-3 text-xs text-muted">
            {SOURCE[value.source]}
            {value.servings ? `, for ${value.servings} servings` : ""}. {value.note}
            {stale ? ` The recipe now makes ${servings}: estimate again.` : ""}
          </p>
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
      {editing && (
        <EditNutrition
          value={value}
          onClose={() => setEditing(false)}
          onSave={async (n) => {
            await api("PUT", `/api/recipes/${recipeId}/nutrition`, n);
            onChange(n && { ...n, source: "you", servings: n.servings ?? servings });
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function EditNutrition({ value, onClose, onSave }: { value: Nutrition | null; onClose: () => void; onSave: (n: Nutrition | null) => Promise<void> }) {
  const keys = ["calories", ...ROWS.map((r) => r.key)] as (keyof Nutrition)[];
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...keys, "servingSize" as const].map((k) => [k, value?.[k] == null ? "" : String(value[k])])));
  const [error, setError] = useState("");
  const save = async (clear = false) => {
    try {
      if (clear) return await onSave(null);
      const n = Object.fromEntries(keys.map((k) => [k, form[k].trim() === "" ? null : Number(form[k])])) as unknown as Nutrition;
      await onSave({ ...n, servingSize: form.servingSize.trim() || null, source: "you" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const label = (k: keyof Nutrition) => (k === "calories" ? "Calories" : ROWS.find((r) => r.key === k)!.label) + (k === "sodium" ? " (mg)" : k === "calories" ? "" : " (g)");
  return (
    <Popup title="Nutrition per serving" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 p-5">
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Serving size
          <input value={form.servingSize} onChange={(e) => setForm({ ...form, servingSize: e.target.value })} maxLength={100} placeholder="About 1½ cups (340 g)" className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
        </label>
        {keys.map((k) => (
          <label key={k} className="text-sm font-semibold text-subtle">
            {label(k)}
            <input inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
          </label>
        ))}
        {error && <p role="alert" className="col-span-2 text-error">{error}</p>}
        <div className="col-span-2 flex items-center gap-3">
          <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
            Save
          </button>
          {value && (
            <button type="button" onClick={() => void save(true)} className="ml-auto text-sm font-semibold text-error hover:underline">
              Remove nutrition facts
            </button>
          )}
        </div>
      </div>
    </Popup>
  );
}

// The label itself (read-only): serving size, calories, the nutrients with % Daily Value, points.
// The recipe page's card and the public share page both show it.
export function NutritionFacts({ value }: { value: Nutrition }) {
  const points = pointsEstimate(value);
  return (
    <>
      {value.servingSize && (
        <p className="mt-3 flex justify-between gap-3 font-semibold">
          <span>Serving size</span>
          <span>{value.servingSize}</span>
        </p>
      )}
      <div className="mt-3 border-y-[6px] border-ink py-2">
        <div className="flex items-end justify-between">
          <span className="text-lg font-black">Calories</span>
          <span className="text-3xl font-black">{value.calories === null ? "–" : Math.round(value.calories)}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="sr-only">Nutrient</th>
            <th className="py-1 text-right text-xs font-semibold text-muted">% Daily Value</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const v = (value[r.key] ?? null) as number | null;
            // Like a US label: "Includes 10 g added sugars", under total sugars (only when known)
            if (r.key === "addedSugar") {
              if (v === null) return null;
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1.5 pl-8">Includes {fmt(v)} g added sugars</td>
                  <td className="py-1.5 text-right font-semibold">{Math.round((v / 50) * 100)}%</td>
                </tr>
              );
            }
            return (
              <tr key={r.key} className="border-t border-line">
                <td className={`py-1.5 ${r.indent ? "pl-4" : "font-semibold"}`}>
                  {r.label} <span className="font-normal">{v === null ? "–" : `${fmt(v)} ${r.unit}`}</span>
                </td>
                <td className="py-1.5 text-right font-semibold">{v !== null && r.dv ? `${Math.round((v / r.dv) * 100)}%` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {points !== null && (
        <p className="mt-3 flex items-center justify-between rounded-lg bg-page px-3 py-2 text-sm">
          <span title="Worked out from calories, saturated fat, sugar (only added sugar, when it's known) and protein, the way points-based diet plans do. Approximate, not any program's official number.">
            Points <span className="text-subtle">(estimate)</span>
          </span>
          <strong className="text-lg">{points}</strong>
        </p>
      )}
    </>
  );
}
