import { useState, type FormEvent } from "react";
import { api } from "../api";

// Settings › Data (owner): wipe every recipe, for starting imports over. The server makes a
// backup first, so Restore can bring it all back.
export function WipeRecipes() {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const wipe = async (e: FormEvent) => {
    e.preventDefault();
    if (typed !== "DELETE") return;
    setBusy(true);
    setDone("");
    setError("");
    try {
      const r = await api<{ recipes: number; backup: string }>("POST", "/api/wipe/recipes", { confirm: "DELETE" });
      setDone(`Wiped ${r.recipes} recipe${r.recipes === 1 ? "" : "s"}. A backup was made first (${r.backup}): restore it above to bring them back.`);
      setTyped("");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <section aria-label="Wipe all recipes" className="rounded-2xl border border-error/30 bg-container p-6">
      <h2 className="text-lg font-semibold text-error">Wipe all recipes</h2>
      <p className="mt-2 text-sm text-subtle">
        Removes every recipe with everything tied to it (versions, ratings, notes, photos, substitutions, meal plan entries for them and the import history), plus all tags and collections. Your categories, grocery list, pantry and settings stay. Handy for testing imports from scratch.
      </p>
      <p className="mt-2 text-sm text-subtle">A backup is made first, so you can restore it from Backups above.</p>
      <form onSubmit={wipe} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-subtle">
          Type DELETE to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="mt-1 block w-40 rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-error" />
        </label>
        <button type="submit" disabled={busy || typed !== "DELETE"} className="rounded bg-error px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {busy ? "Wiping…" : "Wipe all recipes"}
        </button>
      </form>
      {done && (
        <p role="status" className="mt-3 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
