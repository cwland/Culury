import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import { Popup } from "../Popup";

export interface ImportJob {
  id: number;
  kind: "import-url" | "import-text";
  status: "queued" | "running" | "done" | "failed";
  source: string;
  result: { recipeId?: number; title?: string; duplicateOf?: number; how?: "schema.org" | "ai" | "text"; warnings?: string[] } | null;
  error: string | null;
  createdAt: string;
}

// "Check this out https://site.com/recipe" (shared from a phone) -> the link
export const firstLink = (s: string) => s.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;

// Add a recipe from a link or pasted text. The import runs on the server; this shows its progress
// and opens the recipe when it's in.
export default function ImportDialog({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const startLink = initial ? firstLink(initial) : null;
  const [tab, setTab] = useState<"link" | "text">(initial && !startLink ? "text" : "link");
  const [url, setUrl] = useState(startLink ?? "");
  const [text, setText] = useState(initial && !startLink ? initial : "");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<ImportJob[]>([]);
  const started = useRef(false);

  useEffect(() => {
    void api<ImportJob[]>("GET", "/api/imports?limit=6").then(setRecent).catch(() => {});
  }, []);

  // Follow the import until it's done
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = setTimeout(() => void api<ImportJob>("GET", `/api/imports/${job.id}`).then(setJob).catch((e) => setError((e as Error).message)), 900);
    return () => clearTimeout(t);
  }, [job]);
  useEffect(() => {
    if (job?.status === "done" && job.result?.recipeId) {
      onClose();
      window.location.hash = `#/recipes/${job.result.recipeId}${job.result.warnings?.length ? "?imported=warn" : "?imported=1"}`;
    }
  }, [job, onClose]);

  const start = async (body: object) => {
    setError("");
    setJob(null);
    try {
      setJob(await api<ImportJob>("POST", "/api/recipes/import", body));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    void start(tab === "link" ? { url: url.trim() } : { text });
  };
  // Shared from another app: start right away
  useEffect(() => {
    if (startLink && !started.current) {
      started.current = true;
      void start({ url: startLink });
    }
  }, [startLink]);

  const busy = !!job && (job.status === "queued" || job.status === "running");
  const tabClass = (on: boolean) => `-mb-px flex-1 border-b-[3px] px-4 py-2.5 text-sm font-semibold ${on ? "border-primary text-ink" : "border-transparent text-subtle hover:text-ink"}`;

  return (
    <Popup title="Add a recipe" onClose={onClose} wide>
      <div className="p-5 sm:p-6">
        <div role="tablist" className="flex border-b border-line">
          <button type="button" role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")} className={tabClass(tab === "link")}>
            From a link
          </button>
          <button type="button" role="tab" aria-selected={tab === "text"} onClick={() => setTab("text")} className={tabClass(tab === "text")}>
            Paste the recipe
          </button>
        </div>

        <form onSubmit={submit} className="mt-5">
          {tab === "link" ? (
            <>
              <label htmlFor="import-url" className="text-sm font-semibold text-subtle">
                Recipe page, blog post or video
              </label>
              <input
                id="import-url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const link = firstLink(e.clipboardData.getData("text"));
                  if (link) {
                    e.preventDefault();
                    setUrl(link);
                  }
                }}
                inputMode="url"
                placeholder="https://www.seriouseats.com/…"
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-3 text-lg outline-none focus:border-action focus:ring-2 focus:ring-action/15"
              />
              <p className="mt-2 text-sm text-subtle">Most recipe sites import as they are. Other pages, and TikTok, Instagram or YouTube videos, are read by your AI service (Settings › AI).</p>
            </>
          ) : (
            <>
              <label htmlFor="import-text" className="text-sm font-semibold text-subtle">
                The whole recipe: name, ingredients and steps
              </label>
              <textarea
                id="import-text"
                autoFocus
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Grandma's Pancakes\nServes 4\n\nIngredients\n1 1/2 cups flour\n2 eggs\n\nInstructions\nWhisk everything.\nCook on a hot griddle."}
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-sm leading-relaxed outline-none focus:border-action focus:ring-2 focus:ring-action/15"
              />
              <p className="mt-2 text-sm text-subtle">With “Ingredients” and “Instructions” headings it's read straight away; anything else goes to your AI service.</p>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || (tab === "link" ? !url.trim() : text.trim().length < 20)} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
              {busy ? "Importing…" : "Import"}
            </button>
            <a href="#/recipes/new" onClick={onClose} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
              Type it in instead
            </a>
          </div>
        </form>

        <Status job={job} error={error} onRetry={() => job && void api<ImportJob>("POST", `/api/imports/${job.id}/retry`, {}).then(setJob)} onForce={() => job && void api<ImportJob>("POST", `/api/imports/${job.id}/retry`, { force: true }).then(setJob)} onClose={onClose} />

        {recent.length > 0 && (
          <section className="mt-6 border-t border-line pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent imports</h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {recent.map((j) => (
                <li key={j.id} className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${j.status === "done" ? "bg-success" : j.status === "failed" ? "bg-error" : "bg-warning"}`} aria-label={j.status} />
                  {j.result?.recipeId ? (
                    <a href={`#/recipes/${j.result.recipeId}`} onClick={onClose} className="truncate font-medium text-link hover:underline">
                      {j.result.title}
                    </a>
                  ) : (
                    <span className="truncate text-subtle" title={j.error ?? ""}>
                      {j.source}
                      {j.status === "failed" && " (didn't import)"}
                      {j.result?.duplicateOf && " (already saved)"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Popup>
  );
}

function Status({ job, error, onRetry, onForce, onClose }: { job: ImportJob | null; error: string; onRetry: () => void; onForce: () => void; onClose: () => void }) {
  if (error) return <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>;
  if (!job) return null;
  if (job.status === "queued" || job.status === "running")
    return (
      <p role="status" className="mt-4 flex items-center gap-3 rounded-lg bg-pressed px-4 py-3">
        <span className="size-4 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden />
        {job.kind === "import-url" ? "Reading the page…" : "Reading the recipe…"} This can take a little while when AI is used.
      </p>
    );
  if (job.status === "done" && job.result?.duplicateOf)
    return (
      <div role="status" className="mt-4 rounded-lg bg-pressed px-4 py-3">
        <p>That page is already in your recipes.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <a href={`#/recipes/${job.result.duplicateOf}`} onClick={onClose} className="font-semibold text-link hover:underline">
            Open it
          </a>
          <button type="button" onClick={onForce} className="font-semibold text-subtle hover:underline">
            Import another copy
          </button>
        </div>
      </div>
    );
  if (job.status === "failed")
    return (
      <div role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
        <p>{job.error}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          Try again
        </button>
      </div>
    );
  return null;
}
