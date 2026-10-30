import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, api } from "../../api";
import { ingredientsText, stepsText, type CollectionInfo, type Recipe, type TagInfo } from "../../recipes";
import { clearUnsaved, useUnsavedGuard } from "../../unsavedGuard";
import { BackIcon, CloseIcon } from "../Icons";
import { RecipeImage } from "./RecipeList";

interface Form {
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  servings: string;
  yieldText: string;
  prepMinutes: string;
  cookMinutes: string;
  totalMinutes: string;
  ingredients: string;
  steps: string;
  notes: string;
  tags: string[];
  categories: number[];
  collections: number[];
}

const empty: Form = { title: "", description: "", imageUrl: "", sourceUrl: "", sourceName: "", servings: "", yieldText: "", prepMinutes: "", cookMinutes: "", totalMinutes: "", ingredients: "", steps: "", notes: "", tags: [], categories: [], collections: [] };
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const fromRecipe = (r: Recipe): Form => ({
  title: r.title,
  description: str(r.description),
  imageUrl: str(r.imageUrl),
  sourceUrl: str(r.sourceUrl),
  sourceName: str(r.sourceName),
  servings: str(r.servings),
  yieldText: str(r.yieldText),
  prepMinutes: str(r.prepMinutes),
  cookMinutes: str(r.cookMinutes),
  totalMinutes: str(r.totalMinutes),
  ingredients: ingredientsText(r.ingredients),
  steps: stepsText(r.steps),
  notes: str(r.notes),
  tags: r.tags,
  categories: r.categories.map((c) => c.id),
  collections: r.collections.map((c) => c.id),
});

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const labelText = "text-sm font-semibold text-subtle";
const card = "rounded-2xl bg-container p-5 sm:p-6";

export default function RecipeEditor({ id }: { id?: number }) {
  const [form, setForm] = useState<Form | null>(id ? null : empty);
  const [start, setStart] = useState<Form>(empty);
  const [categories, setCategories] = useState<TagInfo[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<TagInfo[]>("GET", "/api/categories").then(setCategories);
    void api<CollectionInfo[]>("GET", "/api/collections").then(setCollections);
    void api<TagInfo[]>("GET", "/api/tags").then(setAllTags);
    if (id)
      api<Recipe>("GET", `/api/recipes/${id}`)
        .then((r) => {
          const f = fromRecipe(r);
          setForm(f);
          setStart(f);
        })
        .catch((e) => setError((e as Error).message));
  }, [id]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== JSON.stringify(start), [form, start]);
  useUnsavedGuard("recipe-editor", dirty, "this recipe");

  if (!form) return <Frame id={id}>{error ? <p role="alert" className="text-error">{error}</p> : null}</Frame>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const num = (s: string) => (s.trim() ? Number(s) : null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    const body = {
      title: form.title,
      description: form.description,
      imageUrl: form.imageUrl,
      sourceUrl: form.sourceUrl,
      sourceName: form.sourceName,
      servings: num(form.servings),
      yieldText: form.yieldText,
      prepMinutes: num(form.prepMinutes),
      cookMinutes: num(form.cookMinutes),
      // blank total: worked out from prep + cook
      ...(form.totalMinutes.trim() || (!form.prepMinutes.trim() && !form.cookMinutes.trim()) ? { totalMinutes: num(form.totalMinutes) } : {}),
      ingredients: form.ingredients,
      steps: form.steps,
      notes: form.notes,
      tags: form.tags,
      categories: form.categories,
      collections: form.collections,
    };
    try {
      const r = await api<Recipe>(id ? "PATCH" : "POST", id ? `/api/recipes/${id}` : "/api/recipes", body);
      setStart(form); // saved: leaving is fine now
      clearUnsaved("recipe-editor");
      window.location.hash = `#/recipes/${r.id}`;
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
        setError("Check the highlighted fields.");
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: "categories" | "collections", v: number) => set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  const Err = ({ k }: { k: string }) => (errors[k] ? <span className="mt-1 block text-sm text-error">{errors[k]}</span> : null);

  return (
    <Frame id={id}>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <section className={card}>
          <h1 className="text-2xl font-semibold">{id ? "Edit recipe" : "New recipe"}</h1>
          <label className="mt-4 block">
            <span className={labelText}>Name</span>
            <input aria-label="Name" autoFocus={!id} value={form.title} onChange={(e) => set("title", e.target.value)} className={`${field} text-lg font-semibold`} placeholder="Weeknight Chili" />
            <Err k="title" />
          </label>
          <label className="mt-4 block">
            <span className={labelText}>Description</span>
            <textarea aria-label="Description" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className={field} placeholder="A line or two about it" />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="block">
              <span className={labelText}>Photo address</span>
              <input aria-label="Photo address" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} className={field} placeholder="https://…/photo.jpg" inputMode="url" />
              <Err k="imageUrl" />
              <span className="mt-1 block text-xs text-muted">Uploading photos comes with import.</span>
            </label>
            <RecipeImage src={form.imageUrl.trim() || null} title="" className="mt-6 hidden aspect-[4/3] w-full rounded-lg sm:flex" />
          </div>
        </section>

        <section className={card}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ["servings", "Servings", "4"],
                ["yieldText", "Makes", "24 cookies"],
                ["prepMinutes", "Prep (min)", "15"],
                ["cookMinutes", "Cook (min)", "30"],
                ["totalMinutes", "Total (min)", "auto"],
              ] as const
            ).map(([k, label, ph]) => (
              <label key={k} className={k === "yieldText" ? "col-span-1" : ""}>
                <span className={labelText}>{label}</span>
                <input aria-label={label} value={form[k]} onChange={(e) => set(k, e.target.value)} className={field} placeholder={ph} inputMode={k === "yieldText" ? "text" : "numeric"} />
                <Err k={k} />
              </label>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className={card}>
            <label className="block">
              <span className="text-xl font-bold">Ingredients</span>
              <span className="mt-1 block text-sm text-subtle">One per line. A line ending in “:” is a heading (For the sauce:).</span>
              <textarea aria-label="Ingredients" rows={14} value={form.ingredients} onChange={(e) => set("ingredients", e.target.value)} className={`${field} font-mono text-sm leading-relaxed`} placeholder={"1 lb ground beef\n1 (15 oz) can kidney beans, drained\n2 tbsp chili powder"} />
            </label>
          </section>
          <section className={card}>
            <label className="block">
              <span className="text-xl font-bold">Steps</span>
              <span className="mt-1 block text-sm text-subtle">A blank line between steps (or one per line). Start a line with # for a heading.</span>
              <textarea aria-label="Steps" rows={14} value={form.steps} onChange={(e) => set("steps", e.target.value)} className={`${field} text-sm leading-relaxed`} placeholder={"Brown the beef in a large pot.\n\nAdd everything else and simmer for 30 minutes."} />
            </label>
          </section>
        </div>

        <section className={card}>
          <h2 className="text-xl font-bold">Organize</h2>
          <div className="mt-3">
            <span className={labelText}>Categories</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c.id} on={form.categories.includes(c.id)} onClick={() => toggle("categories", c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <span className={labelText}>Collections</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {collections.map((c) => (
                <Chip key={c.id} on={form.collections.includes(c.id)} onClick={() => toggle("collections", c.id)}>
                  {c.name}
                </Chip>
              ))}
              {collections.length === 0 && <span className="text-sm text-muted">None yet: add them in Settings › Recipes, or from a recipe's Collections button.</span>}
            </div>
          </div>
          <TagInput tags={form.tags} known={allTags.map((t) => t.name)} onChange={(tags) => set("tags", tags)} />
        </section>

        <section className={card}>
          <h2 className="text-xl font-bold">Source and notes</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelText}>Where it's from (link)</span>
              <input aria-label="Source link" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} className={field} placeholder="https://…" inputMode="url" />
              <Err k="sourceUrl" />
            </label>
            <label>
              <span className={labelText}>Source name</span>
              <input aria-label="Source name" value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} className={field} placeholder="Grandma's card, Serious Eats…" />
            </label>
          </div>
          <label className="mt-4 block">
            <span className={labelText}>Notes (everyone sees these)</span>
            <textarea aria-label="Notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
          </label>
        </section>

        <div className="sticky bottom-14 z-10 -mx-3 flex flex-wrap items-center gap-3 border-t border-line bg-page/95 px-3 py-3 backdrop-blur sm:bottom-0 sm:mx-0 sm:rounded-2xl sm:border-0 sm:bg-container sm:px-6">
          <button type="submit" disabled={busy || !form.title.trim()} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
            {busy ? "Saving…" : id ? "Save changes" : "Save recipe"}
          </button>
          <a href={id ? `#/recipes/${id}` : "#/recipes"} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
            Cancel
          </a>
          {error && <span role="alert" className="text-error">{error}</span>}
        </div>
      </form>
    </Frame>
  );
}

function Frame({ id, children }: { id?: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-6">
      <a href={id ? `#/recipes/${id}` : "#/recipes"} className="mb-3 inline-flex items-center gap-1.5 font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> {id ? "Back to the recipe" : "Recipes"}
      </a>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-action bg-action text-white" : "border-line bg-page text-subtle hover:border-strong hover:text-ink"}`}>
      {children}
    </button>
  );
}

// Type a tag and press Enter or comma; suggestions from tags already used
function TagInput({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/^#/, "");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText("");
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
  };
  const suggestions = text.trim() ? known.filter((k) => k.startsWith(text.trim().toLowerCase()) && !tags.includes(k)).slice(0, 6) : [];
  return (
    <div className="mt-4">
      <label htmlFor="tag-input" className={labelText}>
        Tags
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-page px-2 py-1.5 focus-within:border-action focus-within:ring-2 focus-within:ring-action/15">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-container px-2.5 py-1 text-sm">
            #{t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="text-muted hover:text-error">
              <CloseIcon className="size-3.5" />
            </button>
          </span>
        ))}
        <input id="tag-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} onBlur={() => text.trim() && add(text)} placeholder={tags.length ? "" : "weeknight, vegetarian…"} className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 outline-none" />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="rounded-full bg-pressed px-2.5 py-1 text-sm text-action">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
