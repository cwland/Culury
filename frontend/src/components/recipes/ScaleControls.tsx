import { useEffect, useState } from "react";
import type { Units } from "../../cooking";

// Servings and units for one recipe, remembered in this browser: the scale per recipe, the units
// for every recipe (most people always want the same ones)
const KEY = "culury-cook-prefs";
const read = (): { units?: Units; scale?: Record<string, number> } => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
const write = (v: object) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...v }));
  } catch {
    /* private window: just this visit */
  }
};

export function useCookPrefs(recipeId: number) {
  const [factor, setFactorState] = useState(() => read().scale?.[recipeId] ?? 1);
  const [units, setUnitsState] = useState<Units>(() => read().units ?? "original");
  useEffect(() => {
    setFactorState(read().scale?.[recipeId] ?? 1);
  }, [recipeId]);
  return {
    factor,
    units,
    setFactor: (f: number) => {
      const v = Math.min(Math.max(Math.round(f * 1000) / 1000, 0.125), 50);
      setFactorState(v);
      write({ scale: { ...read().scale, [recipeId]: v } });
    },
    setUnits: (u: Units) => {
      setUnitsState(u);
      write({ units: u });
    },
  };
}

const pill = (on: boolean) => `rounded-md px-2.5 py-1 text-sm font-semibold transition ${on ? "bg-container text-ink shadow-sm" : "text-subtle hover:text-ink"}`;

// "− 4 servings +" (or ½× 1× 2× 3× for recipes without a serving count) and Original / Metric / US
export function ScaleControls({ servings, factor, setFactor, units, setUnits, leans, dark }: { servings: number | null; factor: number; setFactor: (f: number) => void; units: Units; setUnits: (u: Units) => void; leans: "metric" | "us" | null; dark?: boolean }) {
  const group = `inline-flex items-center rounded-lg p-1 ${dark ? "bg-white/10" : "bg-page"}`;
  const now = servings ? Math.round(servings * factor * 100) / 100 : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {servings ? (
        <div className={group} role="group" aria-label="Servings">
          <button type="button" aria-label="Fewer servings" disabled={now! <= 1} onClick={() => setFactor((now! - 1) / servings)} className="size-7 rounded-md text-lg font-bold leading-none hover:bg-container disabled:opacity-30">
            −
          </button>
          <span className="min-w-[6.5rem] px-1 text-center text-sm font-semibold" aria-live="polite">
            {now} serving{now === 1 ? "" : "s"}
            {factor !== 1 && <span className="block text-[11px] font-normal text-muted">recipe makes {servings}</span>}
          </span>
          <button type="button" aria-label="More servings" onClick={() => setFactor((now! + 1) / servings)} className="size-7 rounded-md text-lg font-bold leading-none hover:bg-container">
            +
          </button>
        </div>
      ) : (
        <div className={group} role="radiogroup" aria-label="Recipe size">
          {[0.5, 1, 2, 3].map((f) => (
            <button key={f} type="button" role="radio" aria-checked={factor === f} onClick={() => setFactor(f)} className={pill(factor === f)}>
              {f === 0.5 ? "½" : f}×
            </button>
          ))}
        </div>
      )}
      {factor !== 1 && (
        <button type="button" onClick={() => setFactor(1)} className="text-sm font-semibold text-link hover:underline">
          Reset
        </button>
      )}
      <div className={group} role="radiogroup" aria-label="Units">
        {(["original", "metric", "us"] as const).map((u) => (
          <button key={u} type="button" role="radio" aria-checked={units === u} onClick={() => setUnits(u)} className={pill(units === u)} title={u === "original" ? `As written${leans ? ` (${leans === "us" ? "US" : "metric"})` : ""}` : undefined}>
            {u === "original" ? "As written" : u === "metric" ? "Metric" : "US"}
          </button>
        ))}
      </div>
    </div>
  );
}
