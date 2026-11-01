import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Recipe, TagInfo } from "../../recipes";
import { Popup } from "../Popup";

// Tags on the recipe page: take one off, pick one you've used before, or type a new one.
// Saved on Done (tags aren't part of versions, so nothing asks about one).
export function TagsDialog({ recipe, onClose, onSaved }: { recipe: Recipe; onClose: () => void; onSaved: (r: Recipe) => void }) {
  const [tags, setTags] = useState<string[]>(recipe.tags);
  const [all, setAll] = useState<TagInfo[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<TagInfo[]>("GET", "/api/tags")
      .then(setAll)
      .catch(() => {});
  }, []);

  const add = (t: string) => {
    const tag = t.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
  };
  const done = async () => {
    if (JSON.stringify(tags) === JSON.stringify(recipe.tags)) return onClose();
    setBusy(true);
    setError("");
    try {
      onSaved(await api<Recipe>("PATCH", `/api/recipes/${recipe.id}`, { tags }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const others = all.filter((t) => !tags.includes(t.name));

  return (
    <Popup title="Tags" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <ul aria-label="On this recipe" className="flex flex-wrap gap-2">
          {tags.length === 0 && <li className="text-subtle">No tags yet.</li>}
          {tags.map((t) => (
            <li key={t} className="flex items-center gap-1 rounded-full bg-brand-subtle py-1 pl-3 pr-1 text-sm font-semibold text-action">
              #{t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="flex size-5 items-center justify-center rounded-full hover:bg-action/15">
                ×
              </button>
            </li>
          ))}
        </ul>
        <label className="text-sm font-semibold text-subtle">
          New tag
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(text);
                setText("");
              }
            }}
            placeholder="weeknight, grill, vegetarian…"
            maxLength={60}
            className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-action"
          />
        </label>
        {others.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-subtle">Your tags</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((t) => (
                <button key={t.id} type="button" onClick={() => add(t.name)} className="rounded-full border border-line px-3 py-1 text-sm hover:bg-pressed">
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-error">{error}</p>}
        <div>
          <button type="button" disabled={busy} onClick={() => void done()} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </Popup>
  );
}
