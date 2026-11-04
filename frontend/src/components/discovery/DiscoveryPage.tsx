import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import { Popup } from "../Popup";
import { BackIcon, ChefIcon, DiscoverIcon, FeedIcon, LinkOutIcon, RefreshIcon } from "../Icons";

// Discovery: recipes from the household's RSS / Atom feeds, as cards. Fetching, reading, filtering
// and showing them is plain code on the server: no AI. #/discover is the grid, #/discover/:id one
// post as the feed sent it.

export interface DiscoveryFeed {
  id: number;
  url: string;
  title: string;
  siteUrl: string | null;
  iconUrl: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  items: number;
}
export interface DiscoveryItem {
  id: number;
  feedId: number;
  feedTitle: string;
  feedIcon: string | null;
  title: string;
  link: string | null;
  pubDate: string | null;
  author: string | null;
  categories: string[];
  description: string | null;
  thumbnailUrl: string | null;
  matchedTags: string[];
  contentHtml?: string | null;
  feedSite?: string | null;
}
type Mode = "all" | "tags";

export const ago = (iso: string | null) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return min < 1 ? "just now" : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const postFromHash = () => {
  const m = window.location.hash.match(/^#\/discover\/(\d+)/);
  return m ? Number(m[1]) : null;
};

export default function DiscoveryPage() {
  const [post, setPost] = useState(postFromHash);
  useEffect(() => {
    const onHash = () => setPost(postFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return post ? <Post id={post} /> : <Grid />;
}

// ---------- the grid ----------

const button = "flex items-center gap-2 rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold hover:bg-pressed disabled:opacity-60";

function Grid() {
  const [feeds, setFeeds] = useState<DiscoveryFeed[] | null>(null);
  const [feed, setFeed] = useState<number | "all">("all");
  const [mode, setMode] = useState<Mode>("all");
  const [tags, setTags] = useState<string[]>([]);
  const [items, setItems] = useState<DiscoveryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [said, setSaid] = useState("");
  const asked = useRef(0);

  const loadFeeds = useCallback(() => {
    api<DiscoveryFeed[]>("GET", "/api/discovery/feeds")
      .then(setFeeds)
      .catch((e) => setError((e as Error).message));
  }, []);
  // A page of posts: the first (more = false), or the next one
  const loadItems = useCallback(
    (more = false, after: string | null = null) => {
      const n = ++asked.current;
      const q = new URLSearchParams();
      if (feed !== "all") q.set("feed", String(feed));
      if (mode === "tags") q.set("match", "tags");
      if (more && after) q.set("before", after);
      api<{ items: DiscoveryItem[]; more: boolean; next: string | null }>("GET", `/api/discovery/items?${q}`)
        .then((r) => {
          if (n !== asked.current) return; // a newer list was asked for since
          setItems((old) => (more ? [...(old ?? []), ...r.items] : r.items));
          setNext(r.next);
        })
        .catch((e) => setError((e as Error).message));
    },
    [feed, mode]
  );
  useEffect(() => {
    loadFeeds();
    api<{ tags: string[] }>("GET", "/api/discovery/tags")
      .then((r) => setTags(r.tags))
      .catch(() => {});
  }, [loadFeeds]);
  useEffect(() => {
    setItems(null);
    loadItems();
  }, [loadItems]);

  const saveTags = (next: string[]) => {
    setTags(next);
    void api<{ tags: string[] }>("PUT", "/api/discovery/tags", { tags: next })
      .then((r) => {
        setTags(r.tags);
        if (mode === "tags") loadItems(); // which posts match changed
      })
      .catch((e) => setError((e as Error).message));
  };
  const refresh = async () => {
    setRefreshing(true);
    setSaid("");
    try {
      const r = await api<{ feeds: number; added: number; failed: number }>("POST", "/api/discovery/refresh");
      setSaid([r.added ? plural(r.added, "new post") : "No new posts", r.failed ? `${plural(r.failed, "feed")} couldn't be checked` : ""].filter(Boolean).join(" · "));
      loadFeeds();
      loadItems();
    } catch (e) {
      setError((e as Error).message);
    }
    setRefreshing(false);
  };

  const noFeeds = feeds && !feeds.length;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold sm:text-3xl">Discover</h1>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || !feeds?.length} className={button}>
          <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
        <button type="button" onClick={() => setManaging(true)} className={button}>
          <FeedIcon /> Feeds
        </button>
      </header>
      <p className="mt-1 text-subtle">New recipes from sites you follow. Open one to read it; import the ones you want to keep.</p>
      {said && (
        <p role="status" className="mt-3 text-sm font-semibold text-action">
          {said}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {noFeeds ? (
        <section className="mt-6 flex flex-col items-center rounded-2xl bg-container px-6 py-14 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-subtle text-action">
            <DiscoverIcon className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold">Follow your favorite recipe sites</h2>
          <p className="mt-1 max-w-md text-subtle">Add a site's RSS feed (most food blogs have one), or just its address, and its new recipes show up here.</p>
          <button type="button" onClick={() => setManaging(true)} className="mt-5 rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            Add a feed
          </button>
        </section>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-container p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-subtle">
                Feed
                <select aria-label="Feed" value={feed} onChange={(e) => setFeed(e.target.value === "all" ? "all" : Number(e.target.value))} className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm font-normal text-ink">
                  <option value="all">All feeds</option>
                  {feeds?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </label>
              <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg bg-page p-1 text-sm font-semibold">
                {(
                  [
                    ["all", "Show all"],
                    ["tags", "Filter by tags"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 ${mode === m ? "bg-container shadow-sm" : "text-subtle"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Tags tags={tags} onChange={saveTags} />
          </div>

          {mode === "tags" && !tags.length && <p className="mt-6 text-center text-subtle">Add a tag (like keto, air fryer or chicken) to see the posts that mention it.</p>}
          {items && !items.length && (mode === "all" || tags.length > 0) && (
            <p className="mt-6 text-center text-subtle">{mode === "tags" ? "No posts match your tags yet." : "No posts yet: try Refresh, or check Feeds."}</p>
          )}
          {!!items?.length && (
            <ul aria-label="Recipes from your feeds" className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {items.map((i) => (
                <li key={i.id}>
                  <Card item={i} showTags={mode === "tags"} />
                </li>
              ))}
            </ul>
          )}
          {next && (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => loadItems(true, next)} className={button}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
      {managing && (
        <Feeds
          feeds={feeds ?? []}
          onChanged={() => {
            loadFeeds();
            loadItems();
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

function Card({ item, showTags }: { item: DiscoveryItem; showTags: boolean }) {
  return (
    <a href={`#/discover/${item.id}`} className="group flex h-full flex-col overflow-hidden rounded-2xl bg-container shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)]">
      <FeedImage src={item.thumbnailUrl} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 min-h-[2lh] font-semibold leading-snug group-hover:text-action">{item.title}</h3>
        <p className="mt-1 flex min-w-0 gap-1 overflow-hidden whitespace-nowrap text-xs text-subtle">
          <span className="min-w-0 truncate">{item.feedTitle}</span>
          {item.pubDate && <span className="shrink-0">· {ago(item.pubDate)}</span>}
        </p>
        {showTags && !!item.matchedTags.length && (
          <p className="mt-2 flex flex-wrap gap-1">
            {item.matchedTags.map((t) => (
              <span key={t} className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-action">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>
    </a>
  );
}

// A feed's picture comes from another site: loaded lazily, without telling it where it's shown
// (none: on a post, a picture that doesn't load leaves nothing behind)
function FeedImage({ src, className, none = false }: { src: string | null; className: string; none?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  if (none) return null;
  return (
    <div aria-hidden className={`flex items-center justify-center bg-brand-subtle text-action/70 ${className}`}>
      <ChefIcon />
    </div>
  );
}

// Your tags, as chips: Enter or a comma adds one, × removes it
function Tags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const addAll = (parts: string[]) => {
    const next = [...tags];
    for (const t of parts.map((p) => p.trim()).filter(Boolean)) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    if (next.length !== tags.length) onChange(next);
  };
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    addAll([text]);
    setText("");
  };
  // a comma, typed or pasted: the tags before it are added
  const typed = (value: string) => {
    if (!value.includes(",")) return setText(value);
    const parts = value.split(",");
    const rest = parts.pop()!;
    addAll(parts);
    setText(rest.trimStart());
  };
  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-subtle">Your tags</span>
      <ul aria-label="Your tags" className="contents">
        {tags.map((t) => (
          <li key={t} className="flex items-center gap-1 rounded-full bg-brand-subtle py-1 pl-3 pr-1 text-sm font-semibold text-action">
            {t}
            <button type="button" aria-label={`Remove ${t}`} title={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="flex size-5 items-center justify-center rounded-full hover:bg-action/15">
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label="Add a tag"
        placeholder={tags.length ? "Add a tag" : "Add a tag, like keto or air fryer"}
        value={text}
        maxLength={40}
        onChange={(e) => typed(e.target.value)}
        className="min-w-40 flex-1 rounded-lg border border-line bg-page px-3 py-1.5 text-sm outline-none focus:border-action"
      />
    </form>
  );
}

// ---------- your feeds ----------

function Feeds({ feeds, onChanged, onClose }: { feeds: DiscoveryFeed[]; onChanged: () => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const f = await api<DiscoveryFeed>("POST", "/api/discovery/feeds", { url: url.trim() });
      setMsg({ ok: true, text: `Added “${f.title}”: ${plural(f.items, "post")}.` });
      setUrl("");
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  const remove = async (f: DiscoveryFeed) => {
    try {
      await api("DELETE", `/api/discovery/feeds/${f.id}`);
      setAsking(null);
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  const site = (f: DiscoveryFeed) => {
    try {
      return new URL(f.siteUrl ?? f.url).hostname.replace(/^www\./, "");
    } catch {
      return f.url;
    }
  };
  return (
    <Popup title="Your feeds" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <form onSubmit={(e) => void add(e)} className="flex flex-col gap-2">
          <label htmlFor="feed-url" className="text-sm font-semibold text-subtle">
            Add a feed
          </label>
          <div className="flex gap-2">
            <input id="feed-url" aria-label="Feed or website address" placeholder="https://www.example.com/feed, or just the site" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
            <button type="submit" disabled={busy || !url.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Reading…" : "Add"}
            </button>
          </div>
          <p className="text-xs text-muted">A site's address works too: Culury finds the feed it names. Everyone in the household sees the same feeds.</p>
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-success" : "text-error"}`}>
              {msg.text}
            </p>
          )}
        </form>
        {!!feeds.length && (
          <ul aria-label="Feeds" className="flex flex-col">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-3 first:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{f.title}</p>
                  <p className={`text-xs ${f.lastError ? "text-error" : "text-subtle"}`}>
                    {site(f)} · {plural(f.items, "post")}
                    {f.lastError ? ` · ${f.lastError}` : f.lastFetchedAt ? ` · checked ${ago(f.lastFetchedAt)}` : ""}
                  </p>
                </div>
                {asking === f.id ? (
                  <span className="flex items-center gap-2 text-sm">
                    <button type="button" onClick={() => void remove(f)} className="rounded-lg bg-error px-3 py-1.5 font-semibold text-white">
                      Remove it
                    </button>
                    <button type="button" onClick={() => setAsking(null)} className="font-semibold text-subtle hover:underline">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Remove ${f.title}`} onClick={() => setAsking(f.id)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-subtle hover:bg-pressed">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popup>
  );
}

// ---------- one post ----------

function Post({ id }: { id: number }) {
  const [p, setP] = useState<DiscoveryItem | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setP(null);
    api<DiscoveryItem>("GET", `/api/discovery/items/${id}`)
      .then(setP)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <a href="#/discover" className="inline-flex items-center gap-1 text-sm font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> Discover
      </a>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      {p && (
        <div className="mt-3 overflow-hidden rounded-2xl bg-container">
          <FeedImage src={p.thumbnailUrl} none className="max-h-[420px] w-full" />
          <div className="p-5 sm:p-8">
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
            <p className="mt-2 text-sm text-subtle">{[p.author, p.feedTitle, ago(p.pubDate)].filter(Boolean).join(" · ")}</p>
            {p.link && (
              <a href={p.link} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed">
                Open original site <LinkOutIcon />
              </a>
            )}
            {/* the post as the feed sent it, made safe on the server (lib/rss.ts sanitizeHtml) */}
            {p.contentHtml ? (
              <article aria-label="The post" className="feed-post mt-6" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
            ) : (
              <article aria-label="The post" className="mt-6 text-subtle">
                {p.description ?? "The feed sent no text for this post: open the original site to read it."}
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
