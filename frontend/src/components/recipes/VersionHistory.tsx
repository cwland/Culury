import { useEffect, useState } from "react";
import { api } from "../../api";

// One version as GET /api/recipes/:id/versions lists it (newest first)
export interface VersionInfo {
  number: number;
  source: "import" | "created" | "ai" | "edit";
  summary: string;
  active: boolean;
  createdAt: string;
  by: string | null;
}

const SOURCE: Record<VersionInfo["source"], string> = { import: "Import", created: "Added", ai: "AI", edit: "Edit" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// The Version history tab: every saved version of the recipe and what changed in each
export function VersionHistory({ recipeId, reloadKey }: { recipeId: number; reloadKey?: unknown }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<VersionInfo[]>("GET", `/api/recipes/${recipeId}/versions`)
      .then(setVersions)
      .catch((e) => setError((e as Error).message));
  }, [recipeId, reloadKey]);

  return (
    <section aria-label="Version history" className="rounded-2xl bg-container p-5 sm:p-6">
      <h2 className="text-xl font-bold">Version history</h2>
      <p className="mt-1 text-sm text-subtle">Every change to the recipe's ingredients, steps and details is kept here. Tags, categories and the photo aren't part of versions.</p>
      {error && (
        <p role="alert" className="mt-3 text-error">
          {error}
        </p>
      )}
      {!versions && !error && <p className="mt-3 text-subtle">Loading…</p>}
      {versions && (
        <ul aria-label="Versions" className="mt-4 flex flex-col gap-2">
          {versions.map((v) => (
            <li key={v.number} className={`rounded-xl border px-4 py-3 ${v.active ? "border-action bg-brand-subtle" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="text-lg">v{v.number}</strong>
                <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold text-subtle">{SOURCE[v.source]}</span>
                {v.active && <span className="rounded-full bg-action px-2.5 py-0.5 text-xs font-semibold text-white">Active</span>}
                <span className="ml-auto text-sm text-muted">
                  {when(v.createdAt)}
                  {v.by ? ` · ${v.by}` : ""}
                </span>
              </div>
              <p className="mt-1">{v.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
