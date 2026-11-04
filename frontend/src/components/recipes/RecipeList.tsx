import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { formatMinutes, rememberList, type CollectionInfo, type RecipeSummary, type TagInfo } from "../../recipes";
import { ChefIcon, ClockIcon, FilterIcon, PinIcon, PlusIcon, SearchIcon, StarIcon } from "../Icons";
import { Popup } from "../Popup";
import ImportDialog from "./ImportDialog";

// tag: every tag that's on (recipes must have all of them); "none" = recipes with no tags
type Filters = { q: string; tag: string[]; category: string; collection: string; favorite: string; sort: string };
// Open the import dialog from anywhere (the empty state, the menu)
export const openImport = () => window.dispatchEvent(new Event("culury:import"));
// After the setup wizard: Add recipe glows, with a tip, until it's clicked or the tip is closed
let hintPending = false;
export const hintAddRecipe = () => {
  hintPending = true;
  window.dispatchEvent(new Event("culury:hint-add"));
};
const KEYS = ["q", "category", "collection", "favorite", "sort"] as const;
const fromParams = (p: URLSearchParams): Filters => ({ ...(Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ""])) as Omit<Filters, "tag">), tag: p.getAll("tag") });
const toParams = (f: Filters) => {
  const qs = new URLSearchParams(KEYS.filter((k) => f[k]).map((k) => [k, f[k]]));
  f.tag.forEach((t) => qs.append("tag", t));
  return qs;
};

const SORTS = [
  { id: "", label: "Recently changed" },
  { id: "newest", label: "Newest" },
  { id: "title", label: "A to Z" },
  { id: "rating", label: "Your rating" },
];

export default function RecipeList({ params }: { params: URLSearchParams }) {
  const [f, setF] = useState<Filters>(() => fromParams(params));
  const [search, setSearch] = useState(f.q);
  const [data, setData] = useState<{ total: number; recipes: RecipeSummary[] } | null>(null);
  const [error, setError] = useState("");
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [categories, setCategories] = useState<TagInfo[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [noCategory, setNoCategory] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // ?import=<link or text>: shared from another app (Android share sheet), or a bookmarklet
  const [importing, setImporting] = useState<{ initial?: string } | null>(() => (params.get("import") ? { initial: params.get("import")! } : null));
  useEffect(() => {
    const open = () => setImporting({});
    window.addEventListener("culury:import", open);
    return () => window.removeEventListener("culury:import", open);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState(hintPending);
  useEffect(() => {
    const on = () => setHint(true);
    window.addEventListener("culury:hint-add", on);
    return () => window.removeEventListener("culury:hint-add", on);
  }, []);
  const endHint = () => {
    hintPending = false;
    setHint(false);
  };

  useEffect(() => {
    void Promise.all([api<TagInfo[]>("GET", "/api/tags"), api<TagInfo[]>("GET", "/api/categories"), api<CollectionInfo[]>("GET", "/api/collections")]).then(([t, c, col]) => {
      setTags(t);
      setCategories(c);
      setCollections(col);
    }).catch(() => {}); // the filters are extras: the recipes still list without them
    void api<{ total: number }>("GET", "/api/recipes?category=none&limit=1").then((d) => setNoCategory(d.total)).catch(() => {});
  }, []);

  // The filters live in the address (#/recipes?tag=grill), so Back returns to the same list
  useEffect(() => {
    const qs = toParams(f).toString();
    const hash = `#/recipes${qs ? `?${qs}` : ""}`;
    // (only while still on the list: never rewrite the address of a page you're going to)
    if (window.location.hash.startsWith("#/recipes") && !/^#\/recipes\/./.test(window.location.hash)) {
      history.replaceState(null, "", hash);
      rememberList(hash);
    }
    const query = toParams(f);
    query.set("limit", "200");
    let live = true;
    api<{ total: number; recipes: RecipeSummary[] }>("GET", `/api/recipes?${query}`)
      .then((d) => live && (setData(d), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [f]);

  // Search as you type (a moment after you stop)
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "/" jumps to the search box
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // One place at a time (a collection, a category, or favorites); clicking the one you're in leaves it.
  // Tags narrow wherever you are, and stay on until you click them off (or All recipes).
  const browse = (change: Partial<Filters>) => {
    setF((x) => {
      const [key, value] = Object.entries(change)[0] ?? [];
      if (!key) return { ...x, tag: [], category: "", collection: "", favorite: "" };
      const leaving = x[key as keyof Filters] === value;
      return { ...x, category: "", collection: "", favorite: "", [key]: leaving ? "" : value };
    });
    setFiltersOpen(false);
  };
  const toggleTag = (name: string) =>
    setF((x) => {
      const on = x.tag.includes(name);
      // "No tags" and real tags can't both be on
      const others = x.tag.filter((t) => t !== name && (name === "none" ? false : t !== "none"));
      return { ...x, tag: on ? x.tag.filter((t) => t !== name) : [...others, name] };
    });
  const heading = useMemo(() => {
    if (f.favorite) return "Favorites";
    if (f.collection) return collections.find((c) => String(c.id) === f.collection)?.name ?? "Collection";
    if (f.category === "none") return "No category";
    if (f.category) return categories.find((c) => String(c.id) === f.category)?.name ?? "Category";
    if (f.tag.includes("none")) return "No tags";
    if (f.tag.length) return f.tag.map((t) => `#${t}`).join(" ");
    return "All recipes";
  }, [f, collections, categories]);
  const collection = f.collection ? collections.find((c) => String(c.id) === f.collection) : undefined;

  const sidebar = (
    <BrowseList
      f={f}
      browse={browse}
      toggleTag={toggleTag}
      noCategory={noCategory}
      tags={tags}
      categories={categories}
      collections={collections}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1240px] gap-8 px-3 pb-16 pt-4 sm:px-6">
      <aside aria-label="Browse recipes" className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-56 shrink-0 overflow-y-auto lg:block">
        {sidebar}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">{heading}</h1>
          <div className="relative">
            <button type="button" data-hint={hint || undefined} onClick={() => (endHint(), setImporting({}))} className={`flex items-center gap-1.5 rounded bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-pressed ${hint ? "hint-glow" : ""}`}>
              <PlusIcon className="size-4" /> Add recipe
            </button>
            {hint && (
              <div role="status" aria-label="Tip" className="hint-pop absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl bg-primary p-4 text-sm text-white shadow-[0_12px_32px_rgba(16,24,32,0.3)]">
                <span aria-hidden className="absolute -top-1.5 right-8 size-3 rotate-45 bg-primary" />
                <p>
                  <span aria-hidden>👆 </span>To import your first recipe by hand or from a link, click <strong>Add recipe</strong> any time.
                </p>
                <button type="button" onClick={endHint} className="mt-3 rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25">
                  Got it
                </button>
              </div>
            )}
          </div>
        </div>
        {collection?.description && <p className="mt-1 text-subtle">{collection.description}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-64">
            <span className="sr-only">Search recipes</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, ingredients, tags, notes…"
              className="w-full rounded-lg border border-line bg-container py-2.5 pl-9 pr-3 outline-none focus:border-action focus:ring-2 focus:ring-action/15"
            />
          </label>
          <button type="button" onClick={() => setFiltersOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-2.5 text-sm font-semibold lg:hidden">
            <FilterIcon /> Browse
          </button>
          <select aria-label="Sort" value={f.sort} onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))} className="rounded-lg border border-line bg-container px-3 py-2.5 text-sm">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {f.q && !s.id ? "Best match" : s.label}
              </option>
            ))}
            {f.collection && <option value="collection">Collection order</option>}
          </select>
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
        {data && (
          <p className="mt-3 text-sm text-subtle" aria-live="polite">
            {data.total} recipe{data.total === 1 ? "" : "s"}
            {f.q && <> for “{f.q}”</>}
          </p>
        )}

        {data && data.recipes.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {data.recipes.map((r) => (
              <li key={r.id}>
                <RecipeCard r={r} />
              </li>
            ))}
          </ul>
        )}
        {data && data.recipes.length === 0 && <Empty searching={!!(f.q || f.tag || f.category || f.collection || f.favorite)} />}
      </div>

      {importing && <ImportDialog initial={importing.initial} onClose={() => setImporting(null)} />}
      {filtersOpen && (
        <Popup title="Browse" onClose={() => setFiltersOpen(false)}>
          <div className="p-5">{sidebar}</div>
        </Popup>
      )}
    </div>
  );
}

function BrowseList({ f, browse, toggleTag, noCategory, tags, categories, collections }: { f: Filters; browse: (c: Partial<Filters>) => void; toggleTag: (t: string) => void; noCategory: number; tags: TagInfo[]; categories: TagInfo[]; collections: CollectionInfo[] }) {
  const item = (active: boolean) => `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left ${active ? "bg-pressed font-semibold text-action" : "hover:bg-container"}`;
  const none = !f.tag.length && !f.category && !f.collection && !f.favorite;
  const topTags = [...tags].filter((t) => t.count).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 20);
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mt-5">
      <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="mt-1 flex flex-col">{children}</div>
    </section>
  );
  return (
    <nav className="text-[15px]">
      <button type="button" className={item(none)} onClick={() => browse({})}>
        All recipes
      </button>
      <button type="button" className={item(!!f.favorite)} onClick={() => browse({ favorite: "true" })}>
        <span className="flex items-center gap-2">
          <StarIcon filled className="size-4 text-warning" /> Favorites
        </span>
      </button>
      <Section title="Collections">
        {collections.map((c) => (
          <button key={c.id} type="button" className={item(f.collection === String(c.id))} onClick={() => browse({ collection: String(c.id) })}>
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted">{c.count}</span>
          </button>
        ))}
        <a href="#/settings/recipes" className="px-3 py-1.5 text-sm font-semibold text-link hover:underline">
          {collections.length ? "Manage…" : "+ New collection"}
        </a>
      </Section>
      <Section title="Categories">
        {categories.map((c) => (
          <button key={c.id} type="button" aria-pressed={f.category === String(c.id)} className={item(f.category === String(c.id))} onClick={() => browse({ category: String(c.id) })}>
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted">{c.count}</span>
          </button>
        ))}
        {noCategory > 0 && (
          <button type="button" aria-pressed={f.category === "none"} className={item(f.category === "none")} onClick={() => browse({ category: "none" })}>
            <span className="truncate italic">No category</span>
            <span className="text-xs text-muted">{noCategory}</span>
          </button>
        )}
      </Section>
      {topTags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {[...topTags.map((t) => ({ key: String(t.id), name: t.name, label: t.name })), { key: "none", name: "none", label: "No tags" }].map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={f.tag.includes(t.name)}
                onClick={() => toggleTag(t.name)}
                className={`rounded-full px-2.5 py-1 text-sm ${f.tag.includes(t.name) ? "bg-action text-white" : "bg-container text-subtle hover:text-ink"} ${t.key === "none" ? "italic" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Section>
      )}
    </nav>
  );
}

export function RecipeImage({ src, title, className = "" }: { src: string | null; title: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  return (
    <div aria-hidden className={`flex items-center justify-center bg-brand-subtle text-action/70 ${className}`}>
      <ChefIcon />
      <span className="sr-only">{title}</span>
    </div>
  );
}

function RecipeCard({ r }: { r: RecipeSummary }) {
  const time = formatMinutes(r.totalMinutes);
  return (
    <a href={`#/recipes/${r.id}`} className="group flex h-full flex-col overflow-hidden rounded-2xl bg-container shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)]">
      <div className="relative">
        <RecipeImage src={r.imageUrl} title={r.title} className="aspect-[4/3] w-full" />
        <div className="absolute right-2 top-2 flex gap-1">
          {r.pinned && (
            <span title="Pinned" className="rounded-full bg-container/90 p-1.5 text-action">
              <PinIcon filled className="size-3.5" />
            </span>
          )}
          {r.favorite && (
            <span title="Favorite" className="rounded-full bg-container/90 p-1.5 text-warning">
              <StarIcon filled className="size-3.5" />
            </span>
          )}
        </div>
      </div>
      <div className="p-3">
        {/* Every card the same size: the title always takes two lines, the details one */}
        <h3 className="line-clamp-2 min-h-[2lh] font-semibold leading-snug group-hover:text-action">{r.title}</h3>
        <p className="mt-1 flex min-h-[1lh] min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-subtle">
          {time && (
            <span className="flex shrink-0 items-center gap-1">
              <ClockIcon className="size-3.5" /> {time}
            </span>
          )}
          {r.rating && <span aria-label={`Rated ${r.rating} of 5`}>{"★".repeat(r.rating)}</span>}
          {r.sourceName && <span className="min-w-0 truncate">{r.sourceName}</span>}
        </p>
      </div>
    </a>
  );
}

function Empty({ searching }: { searching: boolean }) {
  return (
    <section className="mt-6 flex flex-col items-center rounded-2xl bg-container px-6 py-14 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-subtle text-action">
        <ChefIcon />
      </span>
      {searching ? (
        <p className="mt-4 text-lg">No recipes match. Try fewer words, or another collection or tag.</p>
      ) : (
        <>
          <p className="mt-4 text-lg">Your recipe box is empty.</p>
          <p className="mt-1 text-subtle">Add your first one from a link to any recipe site, by pasting it, or by typing it in.</p>
          <button type="button" onClick={openImport} className="mt-5 rounded bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            Add a recipe
          </button>
        </>
      )}
    </section>
  );
}
