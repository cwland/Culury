import { useEffect, useState, type FormEvent } from "react";
import type { PlannerSettings } from "../plan";
import { api } from "../api";
import type { CollectionInfo, TagInfo } from "../recipes";
import { ChevronDown, ChevronUp, Trash } from "./Icons";
import { InlineText } from "./inputs";
import { Card } from "./settingsUi";

// Settings › Recipes: the household's categories (in order), collections and tags
export default function OrganizeSettings() {
  return (
    <>
      <MealSlots />
      <NamedList
        title="Categories"
        description="Meal types or courses, in the order you like. Each recipe can be in several."
        path="/api/categories"
        what="category"
        reorder
      />
      <NamedList
        title="Collections"
        description="Your own hand-picked lists, like Quick Meals or Ninja CREAMi. Add recipes to them from a recipe's Collections button."
        path="/api/collections"
        what="collection"
        reorder
        withDescription
      />
      <NamedList
        title="Tags"
        description="Tags are added on each recipe. Rename one here to fix it everywhere; renaming it to another tag's name merges the two."
        path="/api/tags"
        what="tag"
        noAdd
      />
    </>
  );
}

type Item = TagInfo & Partial<Pick<CollectionInfo, "description">>;

function NamedList({ title, description, path, what, reorder, withDescription, noAdd }: { title: string; description: string; path: string; what: string; reorder?: boolean; withDescription?: boolean; noAdd?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const load = () => void api<Item[]>("GET", path).then(setItems);
  useEffect(load, [path]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("POST", path, { name });
      setName("");
    });
  };
  const move = (i: number, to: number) => {
    if (!items || to < 0 || to >= items.length) return;
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x);
    setItems(next);
    void run(() => api("PUT", `${path}/order`, { ids: next.map((n) => n.id) }));
  };

  return (
    <Card title={title} description={description}>
      {items && items.length === 0 && <p className="text-subtle">{noAdd ? "No tags yet. Add them on a recipe." : `No ${what === "category" ? "categories" : `${what}s`} yet.`}</p>}
      <ul className="divide-y divide-line">
        {items?.map((it, i) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            {reorder && (
              <span className="flex flex-col">
                <button type="button" aria-label={`Move ${it.name} up`} title={`Move ${it.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded text-muted hover:text-ink disabled:opacity-30">
                  <ChevronUp />
                </button>
                <button type="button" aria-label={`Move ${it.name} down`} title={`Move ${it.name} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)} className="rounded text-muted hover:text-ink disabled:opacity-30">
                  <ChevronDown />
                </button>
              </span>
            )}
            <span className="min-w-0 flex-1">
              <InlineText value={it.name} ariaLabel={`Rename ${it.name}`} onSave={(v) => void run(() => api("PATCH", `${path}/${it.id}`, { name: v }))} className="w-full font-medium" />
              {withDescription && (
                <InlineText value={it.description ?? ""} allowEmpty placeholder="Add a description" ariaLabel={`Description of ${it.name}`} onSave={(v) => void run(() => api("PATCH", `${path}/${it.id}`, { description: v }))} className="w-full text-sm text-subtle" />
              )}
            </span>
            <a href={`#/recipes?${what}=${what === "tag" ? encodeURIComponent(it.name) : it.id}`} className="shrink-0 text-sm text-link hover:underline">
              {it.count} recipe{it.count === 1 ? "" : "s"}
            </a>
            <button
              type="button"
              aria-label={confirmId === it.id ? `Confirm delete ${it.name}` : `Delete ${it.name}`} title={confirmId === it.id ? `Confirm delete ${it.name}` : `Delete ${it.name}`}
              onClick={() => (confirmId === it.id ? void run(() => api("DELETE", `${path}/${it.id}`)) : setConfirmId(it.id))}
              onBlur={() => setConfirmId(null)}
              className={`shrink-0 rounded px-2 py-1.5 text-sm font-semibold ${confirmId === it.id ? "bg-error text-white" : "text-muted hover:bg-error-subtle hover:text-error"}`}
            >
              {confirmId === it.id ? "Delete?" : <Trash />}
            </button>
          </li>
        ))}
      </ul>
      {!noAdd && (
        <form onSubmit={add} className="mt-3 flex gap-2">
          <input aria-label={`New ${what}`} placeholder={`New ${what}`} value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded border border-muted/50 bg-container px-3 py-2 outline-none focus:border-action focus:ring-2 focus:ring-action/15" />
          <button type="submit" disabled={!name.trim()} className="rounded bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </Card>
  );
}

// The meal plan's rows (Breakfast, Lunch, Dinner, Snack) and the first day of the week
function MealSlots() {
  const [s, setS] = useState<PlannerSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => void api<PlannerSettings>("GET", "/api/plan/settings").then(setS), []);
  const save = async (change: Partial<PlannerSettings>) => {
    setError("");
    try {
      setS(await api<PlannerSettings>("PUT", "/api/plan/settings", change));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!s) return null;
  const move = (i: number, to: number) => {
    if (to < 0 || to >= s.slots.length) return;
    const next = [...s.slots];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x);
    void save({ slots: next });
  };
  return (
    <Card title="Meal plan" description="The meals on the plan, in order, and the day your week starts.">
      <ul className="divide-y divide-line">
        {s.slots.map((slot, i) => (
          <li key={slot.id} className="flex items-center gap-2 py-2">
            <span className="flex flex-col">
              <button type="button" aria-label={`Move ${slot.name} up`} title={`Move ${slot.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="text-muted hover:text-ink disabled:opacity-30">
                <ChevronUp />
              </button>
              <button type="button" aria-label={`Move ${slot.name} down`} title={`Move ${slot.name} down`} disabled={i === s.slots.length - 1} onClick={() => move(i, i + 1)} className="text-muted hover:text-ink disabled:opacity-30">
                <ChevronDown />
              </button>
            </span>
            <InlineText value={slot.name} ariaLabel={`Rename ${slot.name}`} onSave={(v) => void save({ slots: s.slots.map((x) => (x.id === slot.id ? { ...x, name: v } : x)) })} className="w-full flex-1 font-medium" />
            <button type="button" aria-label={`Remove ${slot.name}`} title={`Remove ${slot.name}`} disabled={s.slots.length === 1} onClick={() => void save({ slots: s.slots.filter((x) => x.id !== slot.id) })} className="rounded px-2 py-1.5 text-muted hover:bg-error-subtle hover:text-error disabled:opacity-30">
              <Trash />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save({ slots: [...s.slots, { id: "", name: name.trim() }] }).then(() => setName(""));
        }}
        className="mt-3 flex gap-2"
      >
        <input aria-label="New meal" placeholder="New meal (Brunch, Dessert…)" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded border border-muted/50 bg-container px-3 py-2 outline-none focus:border-action" />
        <button type="submit" disabled={!name.trim()} className="rounded bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </form>
      <label className="mt-4 flex items-center gap-3 text-sm font-semibold text-subtle">
        Weeks start on
        <select value={s.weekStart} onChange={(e) => void save({ weekStart: Number(e.target.value) as 0 | 1 })} className="rounded border border-line bg-container px-2 py-1.5">
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </Card>
  );
}
