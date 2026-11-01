import { useEffect, useState } from "react";
import type { Units } from "../../cooking";
import { UndoIcon } from "../Icons";

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
const step = "size-7 rounded-md text-lg font-bold leading-none hover:bg-container disabled:opacity-30";

// Sizes for a recipe without a serving count: − 1× + steps through these
const SIZES = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const FRACTION: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
// 1.5 -> "1½×", 0.5 -> "½×", 3 -> "3×"
const sizeLabel = (f: number) => {
  const whole = Math.floor(f);
  const frac = FRACTION[Math.round((f - whole) * 100) / 100];
  return `${whole || !frac ? whole : ""}${frac ?? (f % 1 ? String(f - whole).slice(1) : "")}×`;
};

// "− 4 servings +" (or "− 1× +" for recipes without a serving count), a reset icon, and
// As written / Metric / US. The reset icon keeps its space when hidden, so nothing moves.
export function ScaleControls({ servings, factor, setFactor, units, setUnits, leans, dark }: { servings: number | null; factor: number; setFactor: (f: number) => void; units: Units; setUnits: (u: Units) => void; leans: "metric" | "us" | null; dark?: boolean }) {
  const group = `inline-flex items-center rounded-lg p-1 ${dark ? "bg-white/10" : "bg-page"}`;
  const now = servings ? Math.round(servings * factor * 100) / 100 : null;
  const bigger = SIZES.find((f) => f > factor + 1e-9);
  const smaller = [...SIZES].reverse().find((f) => f < factor - 1e-9);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {servings ? (
        <div className={group} role="group" aria-label="Servings">
          <button type="button" aria-label="Fewer servings" disabled={now! <= 1} onClick={() => setFactor((now! - 1) / servings)} className={step}>
            −
          </button>
          <span className="min-w-[6.5rem] px-1 text-center text-sm font-semibold" aria-live="polite">
            {now} serving{now === 1 ? "" : "s"}
            {factor !== 1 && <span className="block text-[11px] font-normal text-muted">recipe makes {servings}</span>}
          </span>
          <button type="button" aria-label="More servings" onClick={() => setFactor((now! + 1) / servings)} className={step}>
            +
          </button>
        </div>
      ) : (
        <div className={group} role="group" aria-label="Recipe size">
          <button type="button" aria-label="Make less" disabled={smaller === undefined} onClick={() => smaller !== undefined && setFactor(smaller)} className={step}>
            −
          </button>
          <span className="min-w-[3.5rem] px-1 text-center text-sm font-semibold" aria-live="polite">
            {sizeLabel(factor)}
          </span>
          <button type="button" aria-label="Make more" disabled={bigger === undefined} onClick={() => bigger !== undefined && setFactor(bigger)} className={step}>
            +
          </button>
        </div>
      )}
      <span data-testid="reset-slot" className="inline-flex size-7 shrink-0 items-center justify-center">
        {factor !== 1 && (
          <button type="button" aria-label="Back to the recipe's amounts" title="Back to the recipe's amounts" onClick={() => setFactor(1)} className="flex size-7 items-center justify-center rounded-md text-link hover:bg-pressed">
            <UndoIcon className="size-4" />
          </button>
        )}
      </span>
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
