import { useEffect, useState, type FormEvent } from "react";
import { api, uploadPhoto } from "../../api";
import { formatMinutes, listAddress, siteName, type CollectionInfo, type Ingredient, type Mine, type Recipe, type Substitution } from "../../recipes";
import { BackIcon, ChefIcon, GroceryIcon, ShareIcon, ClockIcon, CollectionAddIcon, EditIcon, LinkOutIcon, PinIcon, ServingsIcon, StarIcon, Trash, WandIcon, MoreIcon } from "../Icons";
import { useAiStatus } from "../../ai";
import EnhanceWizard from "./EnhanceWizard";
import { useLive } from "../../live";
import { Popup } from "../Popup";
import { RecipeImage } from "./RecipeList";
import AddToListDialog from "../grocery/AddToListDialog";
import { NutritionCard } from "./NutritionCard";
import { VersionHistory } from "./VersionHistory";
import ShareDialog from "./ShareDialog";
import { ScaleControls, useCookPrefs } from "./ScaleControls";
import { StepText } from "./StepText";
import { ingredientLine, recipeUnits, type Units } from "../../cooking";

const card = "rounded-2xl bg-container p-5 sm:p-6";
const smallButton = "flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold hover:bg-pressed";

export default function RecipeView({ id }: { id: number }) {
  const [r, setR] = useState<Recipe | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const prefs = useCookPrefs(id);
  const ai = useAiStatus();
  // Just added (typed in or imported): offer an AI check once
  const [offer, setOffer] = useState(() => /[?&](added|imported)=/.test(window.location.hash));
  const [enhancing, setEnhancing] = useState(false);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<"recipe" | "nutrition" | "history">("recipe");

  useEffect(() => {
    setR(null);
    api<Recipe>("GET", `/api/recipes/${id}`)
      .then(setR)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  // Auto nutrition finished for this recipe (here or on another device): show the new numbers
  useLive(["recipes"], (e) => {
    if (e.id === id) void api<Recipe>("GET", `/api/recipes/${id}`).then((fresh) => setR((x) => (x ? { ...x, nutrition: fresh.nutrition, nutritionUpdating: fresh.nutritionUpdating } : fresh)));
  });

  if (error) return <Shell><p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p></Shell>;
  if (!r) return <Shell />;

  const setMine = async (change: Partial<Mine>) => {
    setR((x) => (x ? { ...x, me: { ...x.me, ...change } } : x)); // right away; the server confirms
    try {
      const me = await api<Mine>("PUT", `/api/recipes/${r.id}/me`, change);
      setR((x) => (x ? { ...x, me } : x));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // The AI check offer was turned down, or the check closed with nothing applied: with Auto
  // nutrition on, the server works nutrition out now instead (it waited so AI wasn't asked twice)
  const skipAiCheck = () => {
    void api("POST", `/api/recipes/${r.id}/enhance/skip`)
      .then(() => api<Recipe>("GET", `/api/recipes/${r.id}`))
      .then((fresh) => setR((x) => (x ? { ...x, nutrition: fresh.nutrition, nutritionUpdating: fresh.nutritionUpdating } : x)))
      .catch(() => {});
  };
  const remove = async () => {
    await api("DELETE", `/api/recipes/${r.id}`);
    window.location.hash = "#/recipes";
  };

  const times = [
    ["Prep", r.prepMinutes],
    ["Cook", r.cookMinutes],
    ["Total", r.totalMinutes],
  ].filter(([, m]) => m) as [string, number][];
  const source = r.sourceName || siteName(r.sourceUrl);

  const imported = /[?&]imported=/.test(window.location.hash);
  return (
    <Shell>
      {imported && (
        <p role="status" className="mb-3 rounded-lg bg-success-subtle px-4 py-3 text-success">
          Imported. Give it a quick look, and <a href={`#/recipes/${r.id}/edit`} className="font-semibold underline">edit</a> anything that came through wrong.
          {/[?&]imported=warn/.test(window.location.hash) && " The photo couldn't be saved here, so it's shown from the site."}
        </p>
      )}
      {ai.enhance && offer && (
        <section aria-label="AI check offer" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-brand-subtle px-4 py-3">
          <WandIcon className="size-5 shrink-0 text-action" />
          <p className="min-w-0 flex-1">Check this recipe with AI? It can fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOffer(false);
                skipAiCheck();
              }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-subtle hover:underline"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setOffer(false);
                setEnhancing(true);
              }}
              className="rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Check with AI
            </button>
          </div>
        </section>
      )}
      {/* Header: photo, name, the facts, and what you can do with it */}
      <section className="overflow-hidden rounded-2xl bg-container md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <PhotoSlot recipe={r} onChange={(imageUrl) => setR({ ...r, imageUrl })} />
        <div className="flex flex-col p-5 sm:p-7 md:pt-5">
          {/* The categories on the left, Start cooking on the right */}
          {(r.categories.length > 0 || r.steps.length > 0) && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-action">{r.categories.map((c) => c.name).join(" · ")}</p>
              {r.steps.length > 0 && (
                <a href={`#/recipes/${r.id}/cook`} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-pressed">
                  <ChefIcon className="size-4" /> Start cooking
                </a>
              )}
            </div>
          )}
          <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight">{r.title}</h1>
          {r.description && <p className="mt-3 text-subtle">{r.description}</p>}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {times.map(([label, m]) => (
              <span key={label} className="flex items-center gap-1.5">
                <ClockIcon className="size-4 text-muted" />
                <span className="text-subtle">{label}</span> <strong>{formatMinutes(m)}</strong>
              </span>
            ))}
            {(r.servings || r.yieldText) && (
              <span className="flex items-center gap-1.5">
                <ServingsIcon className="size-4 text-muted" />
                <strong>{r.yieldText || `${r.servings} servings`}</strong>
              </span>
            )}
          </div>
          {source && (
            <p className="mt-3 text-sm text-subtle">
              From{" "}
              {r.sourceUrl ? (
                <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                  {source} <LinkOutIcon className="size-3.5" />
                </a>
              ) : (
                <strong>{source}</strong>
              )}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Stars value={r.me.rating} onChange={(rating) => void setMine({ rating })} />
          </div>

          {/* Using it */}
          <div className="flex flex-wrap gap-2 pt-5">
            {r.ingredients.length > 0 && (
              <button type="button" onClick={() => setShopping(true)} className={smallButton}>
                <GroceryIcon className="size-4" /> Add to grocery list
              </button>
            )}
            <button type="button" aria-pressed={r.me.favorite} onClick={() => void setMine({ favorite: !r.me.favorite })} className={`${smallButton} ${r.me.favorite ? "border-warning/50 text-warning" : ""}`}>
              <StarIcon filled={r.me.favorite} className="size-4" /> {r.me.favorite ? "Favorite" : "Add to favorites"}
            </button>
            <button type="button" aria-pressed={r.me.pinned} onClick={() => void setMine({ pinned: !r.me.pinned })} className={`${smallButton} ${r.me.pinned ? "border-action/50 text-action" : ""}`}>
              <PinIcon filled={r.me.pinned} className="size-4" /> {r.me.pinned ? "Pinned" : "Pin to top"}
            </button>
            <button type="button" onClick={() => setPicking(true)} className={smallButton}>
              <CollectionAddIcon /> Collections
            </button>
            <button type="button" onClick={() => setSharing(true)} className={smallButton}>
              <ShareIcon /> Share
            </button>
          </div>
          {/* Changing it */}
          <div className="flex flex-wrap gap-2 pt-2">
            <a href={`#/recipes/${r.id}/edit`} className={smallButton}>
              <EditIcon /> Edit
            </a>
            {ai.enhance && (
              <button type="button" onClick={() => setEnhancing(true)} className={smallButton}>
                <WandIcon /> AI check
              </button>
            )}
            <div className="relative">
              <button type="button" aria-label="More" aria-expanded={more} onClick={() => setMore((m) => !m)} className={smallButton}>
                <MoreIcon />
              </button>
              {more && (
                <div role="menu" className="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-xl bg-container py-1 shadow-[0_8px_28px_rgba(0,0,0,0.16)]" onMouseLeave={() => setMore(false)}>
                  <button role="menuitem" type="button" onClick={() => (setMore(false), setConfirmDelete(true))} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-error hover:bg-error-subtle">
                    <Trash /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {(r.tags.length > 0 || r.collections.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {r.collections.map((c) => (
            <a key={c.id} href={`#/recipes?collection=${c.id}`} className="rounded-full bg-brand-subtle px-3 py-1 text-sm font-semibold text-action hover:underline">
              {c.name}
            </a>
          ))}
          {r.tags.map((t) => (
            <a key={t} href={`#/recipes?tag=${encodeURIComponent(t)}`} className="rounded-full bg-container px-3 py-1 text-sm text-subtle hover:text-ink">
              #{t}
            </a>
          ))}
        </div>
      )}

      {/* Tabs: the recipe itself, its nutrition, and its versions (when versioning is on) */}
      <div role="tablist" aria-label="Recipe sections" className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-container p-1">
        {(
          [
            ["recipe", "Active recipe"],
            ["nutrition", "Nutrition"],
            ...(r.versioning ? [["history", "Version history"]] : []),
          ] as [typeof tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? "bg-action text-white" : "text-subtle hover:bg-pressed hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "recipe" && (
        <div role="tabpanel" id="panel-recipe" aria-labelledby="tab-recipe">
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section aria-label="Ingredients" className={`${card} self-start`}>
              <h2 className="text-xl font-bold">Ingredients</h2>
              {r.ingredients.some((i) => i.quantity || i.unit) && (
                <div className="mt-3">
                  <ScaleControls servings={r.servings} factor={prefs.factor} setFactor={prefs.setFactor} units={prefs.units} setUnits={prefs.setUnits} leans={recipeUnits(r.ingredients)} />
                </div>
              )}
              {r.ingredients.length ? (
                <ul className="mt-3">
                  {r.ingredients.map((i, n) =>
                    i.section ? (
                      <li key={n} className="mt-4 pb-1 text-sm font-semibold uppercase tracking-wide text-muted first:mt-0">
                        {i.section}
                      </li>
                    ) : (
                      <li key={n} className="border-b border-line py-2 last:border-0">
                        <IngredientLine i={i} factor={prefs.factor} units={prefs.units} />
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-subtle">No ingredients yet.</p>
              )}
            </section>

            <section aria-label="Steps" className={card}>
              <h2 className="text-xl font-bold">Steps</h2>
              {r.steps.length ? <Steps steps={r.steps} units={prefs.units} recipe={r} /> : <p className="mt-2 text-subtle">No steps yet.</p>}
            </section>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {r.notes && (
              <section aria-label="Recipe notes" className={card}>
                <h2 className="text-xl font-bold">Notes</h2>
                <p className="mt-2 whitespace-pre-line">{r.notes}</p>
              </section>
            )}
            <MyNotes value={r.me.notes} onSave={(notes) => setMine({ notes })} />
            <Substitutions recipeId={r.id} list={r.substitutions} onChange={(substitutions) => setR({ ...r, substitutions })} />
          </div>
        </div>
      )}
      {tab === "nutrition" && (
        <div role="tabpanel" id="panel-nutrition" aria-labelledby="tab-nutrition" className="mt-4">
          <NutritionCard recipeId={r.id} servings={r.servings} value={r.nutrition} updating={r.nutritionUpdating} onChange={(nutrition) => setR({ ...r, nutrition })} />
        </div>
      )}
      {tab === "history" && r.versioning && (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" className="mt-4">
          <VersionHistory recipeId={r.id} reloadKey={r.updatedAt} />
        </div>
      )}

      {enhancing && (
        <EnhanceWizard
          recipe={r}
          onClose={() => {
            setEnhancing(false);
            skipAiCheck();
          }}
          onApplied={(updated) => {
            setR(updated);
            setEnhancing(false);
          }}
        />
      )}
      {sharing && <ShareDialog recipe={r} onClose={() => setSharing(false)} />}
      {shopping && <AddToListDialog title={r.title} source={{ recipes: [{ recipeId: r.id, ...(r.servings ? { servings: Math.round(r.servings * prefs.factor * 100) / 100 } : {}) }] }} onClose={() => setShopping(false)} />}
      {picking && <CollectionPicker recipe={r} onClose={() => setPicking(false)} onChange={(collections) => setR({ ...r, collections })} />}
      {confirmDelete && (
        <Popup title="Delete this recipe?" onClose={() => setConfirmDelete(false)}>
          <div className="p-6">
            <p>
              <strong>{r.title}</strong> will be deleted for everyone in your household, with its notes, ratings and substitutions. This can't be undone (a backup can bring it back).
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-2.5 font-semibold text-subtle hover:underline">
                Cancel
              </button>
              <button type="button" onClick={() => void remove()} className="rounded bg-error px-4 py-2.5 font-semibold text-white">
                Delete recipe
              </button>
            </div>
          </div>
        </Popup>
      )}
    </Shell>
  );
}

// The recipe's photo; click (or drop a file) to add or change it
function PhotoSlot({ recipe, onChange }: { recipe: Recipe; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadPhoto(`/api/recipes/${recipe.id}/photo`, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      // Every recipe photo is the same 4:3 box, cropped to fill (uploads come in all shapes)
      className="group relative block aspect-[4/3] cursor-pointer overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void send(e.dataTransfer.files[0]);
      }}
    >
      <RecipeImage src={recipe.imageUrl} title={recipe.title} className="absolute inset-0 h-full w-full" />
      <input type="file" accept="image/*" className="sr-only" aria-label={recipe.imageUrl ? "Change photo" : "Add a photo"} onChange={(e) => void send(e.target.files?.[0])} />
      <span className={`absolute bottom-3 left-3 rounded-full bg-container/90 px-3 py-1.5 text-sm font-semibold shadow transition ${recipe.imageUrl && !busy ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : ""}`}>
        {busy ? "Uploading…" : recipe.imageUrl ? "Change photo" : "Add a photo"}
      </span>
      {error && <span role="alert" className="absolute inset-x-3 top-3 rounded bg-error-subtle px-3 py-2 text-sm text-error">{error}</span>}
    </label>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-6">
      <a href={listAddress()} className="mb-3 inline-flex items-center gap-1.5 font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> Recipes
      </a>
      {children}
    </div>
  );
}

// "1½ cups flour, sifted": the amount in bold, at this scale and in these units
export function IngredientLine({ i, factor = 1, units = "original" }: { i: Ingredient; factor?: number; units?: Units }) {
  const line = ingredientLine(i, factor, units);
  if (line.plain) return <span>{line.name}</span>;
  return (
    <span>
      <strong className="font-semibold">{line.amount}</strong> {line.name}
      {line.note && <span className="text-subtle">, {line.note}</span>}
    </span>
  );
}

function Steps({ steps, units, recipe }: { steps: Recipe["steps"]; units: Units; recipe: Recipe }) {
  let n = 0;
  return (
    <ol className="mt-3 flex flex-col gap-4">
      {steps.map((s, i) => {
        if (s.section)
          return (
            <li key={i} className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">
              {s.section}
            </li>
          );
        const num = ++n;
        return (
          <li key={i} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-bold text-action">{num}</span>
            <p className="pt-0.5 leading-relaxed">
              <StepText text={s.text} units={units} recipe={recipe} stepNumber={num} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? null : n)}
          className={`p-0.5 ${n <= shown ? "text-warning" : "text-strong"}`}
        >
          <StarIcon filled={n <= shown} className="size-6" />
        </button>
      ))}
      <span className="ml-2 text-sm text-subtle">{value ? "Your rating" : "Rate it"}</span>
    </div>
  );
}

function MyNotes({ value, onSave }: { value: string | null; onSave: (v: string | null) => Promise<void> }) {
  const [text, setText] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = text.trim() !== (value ?? "");
  const save = async () => {
    if (!dirty) return;
    await onSave(text.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <section aria-label="My notes" className={card}>
      <h2 className="flex items-baseline gap-2 text-xl font-bold">
        My notes <span className="text-sm font-normal text-muted">only you see these</span>
      </h2>
      <textarea
        aria-label="My notes"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        rows={4}
        placeholder="What you'd change next time…"
        className="mt-3 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action focus:ring-2 focus:ring-action/15"
      />
      <p className="h-5 text-sm text-success" role="status">
        {saved && "Saved"}
      </p>
    </section>
  );
}

function Substitutions({ recipeId, list, onChange }: { recipeId: number; list: Substitution[]; onChange: (l: Substitution[]) => void }) {
  const [original, setOriginal] = useState("");
  const [replacement, setReplacement] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const s = await api<Substitution>("POST", `/api/recipes/${recipeId}/substitutions`, { original, replacement, note });
      onChange([s, ...list]);
      setOriginal("");
      setReplacement("");
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (id: number) => {
    await api("DELETE", `/api/substitutions/${id}`);
    onChange(list.filter((s) => s.id !== id));
  };
  const input = "min-w-0 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";
  return (
    <section aria-label="Substitutions" className={card}>
      <h2 className="text-xl font-bold">Substitutions</h2>
      <p className="mt-1 text-sm text-subtle">What you swapped when you made it, so you remember next time.</p>
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <input aria-label="Instead of" placeholder="Instead of (sour cream)" value={original} onChange={(e) => setOriginal(e.target.value)} className={input} />
        <span className="hidden self-center text-muted sm:block">→</span>
        <input aria-label="I used" placeholder="I used (Greek yogurt)" value={replacement} onChange={(e) => setReplacement(e.target.value)} className={input} />
        <input aria-label="How it went" placeholder="How it went (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={`${input} sm:col-span-2`} />
        <button type="submit" disabled={!original.trim() || !replacement.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="text-subtle line-through decoration-muted/60">{s.original}</span> → <strong>{s.replacement}</strong>
                {s.note && <span className="block text-sm text-subtle">{s.note}</span>}
                <span className="block text-xs text-muted">{new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
              </span>
              <button type="button" aria-label={`Remove ${s.original} → ${s.replacement}`} onClick={() => void remove(s.id)} className="rounded p-1.5 text-muted hover:bg-error-subtle hover:text-error">
                <Trash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CollectionPicker({ recipe, onClose, onChange }: { recipe: Recipe; onClose: () => void; onChange: (c: Recipe["collections"]) => void }) {
  const [all, setAll] = useState<CollectionInfo[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inIt = new Set(recipe.collections.map((c) => c.id));
  useEffect(() => {
    void api<CollectionInfo[]>("GET", "/api/collections").then(setAll);
  }, []);
  const toggle = async (c: CollectionInfo) => {
    if (inIt.has(c.id)) {
      await api("DELETE", `/api/collections/${c.id}/recipes/${recipe.id}`);
      onChange(recipe.collections.filter((x) => x.id !== c.id));
    } else {
      await api("POST", `/api/collections/${c.id}/recipes`, { recipeId: recipe.id });
      onChange([...recipe.collections, { id: c.id, name: c.name }]);
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const c = await api<CollectionInfo>("POST", "/api/collections", { name });
      setAll((a) => [...(a ?? []), c]);
      setName("");
      await toggle(c);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Popup title="Collections" onClose={onClose}>
      <div className="p-5">
        {all && all.length === 0 && <p className="text-subtle">No collections yet. Make one below.</p>}
        <ul className="flex flex-col">
          {all?.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-pressed">
                <input type="checkbox" checked={inIt.has(c.id)} onChange={() => void toggle(c)} className="size-4 accent-action" />
                <span className="flex-1">{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <form onSubmit={create} className="mt-3 flex gap-2 border-t border-line pt-4">
          <input aria-label="New collection" placeholder="New collection" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      </div>
    </Popup>
  );
}
