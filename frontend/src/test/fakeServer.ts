import { vi } from "vitest";

// A pretend Culury server at the HTTP boundary: the screens and api.ts run for real, only fetch is
// replaced. Routes answer with the same shapes the real API sends; every request is recorded so tests
// can check what was sent.
export interface Sent {
  method: string;
  path: string;
  body: any;
}
type Handler = (body: any, path: string) => { status?: number; json?: unknown } | unknown;

export function fakeServer(routes: Record<string, Handler>) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    sent.push({ method, path, body });
    const key = Object.keys(routes).find((k) => {
      const [m, pattern] = k.split(" ");
      return m === method && new RegExp(`^${pattern.replace(/:\w+/g, "[^/?]+")}(\\?.*)?$`).test(path);
    });
    if (!key) return new Response(JSON.stringify({ error: `No fake for ${method} ${path}` }), { status: 404 });
    const out = (await routes[key](body, path)) as { status?: number; json?: unknown };
    // { status: 201, json: … } sets the HTTP status; anything else is the JSON itself (a job has its own "status")
    const isWrapped = !!out && typeof out === "object" && typeof out.status === "number" && Object.keys(out).every((k) => k === "status" || k === "json");
    const status = isWrapped ? (out.status ?? 200) : 200;
    const json = isWrapped ? out.json : out;
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(json ?? {}), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, writes: () => sent.filter((s) => s.method !== "GET") };
}

// A recipe exactly as GET /api/recipes/:id returns it
export function recipeJson(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "Weeknight Chili",
    description: null,
    ingredients: [
      { raw: "1 lb ground beef", quantity: 1, quantityMax: null, unit: "lb", name: "ground beef", note: null },
      { raw: "2 tbsp chili powder", quantity: 2, quantityMax: null, unit: "tbsp", name: "chili powder", note: null },
    ],
    steps: [{ text: "Brown the beef." }, { text: "Simmer for 30 minutes." }],
    servings: 4,
    yieldText: null,
    prepMinutes: 10,
    cookMinutes: 40,
    totalMinutes: 50,
    sourceUrl: null,
    sourceName: null,
    imageUrl: null,
    notes: null,
    nutrition: null,
    createdBy: 1,
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-10-30T12:00:00.000Z",
    tags: ["beef"],
    categories: [{ id: 3, name: "Dinner" }],
    collections: [],
    me: { favorite: false, pinned: false, rating: null, notes: null },
    substitutions: [],
    ...over,
  };
}
