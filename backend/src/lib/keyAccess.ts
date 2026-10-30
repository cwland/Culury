// What an API key may do. Picked when the key is created (and changeable later):
//  - read:          look at recipes, meal plans, grocery lists and pantry (GET only)
//  - write:         add, change and delete them (no reading)
//  - recipe_push:   only send in recipes (a URL to import, or a finished recipe) and check on imports
//  - grocery_write: only add to, check off and change grocery lists
//  - admin:         read + write everything above, plus logs, backups and exports
// No key can ever see or change settings, other keys, sign-in details, or restore a backup.
export const KEY_ACCESS = ["read", "write", "recipe_push", "grocery_write", "admin"] as const;
export type KeyAccess = (typeof KEY_ACCESS)[number];

export const KEY_ACCESS_LABELS: Record<KeyAccess, string> = {
  read: "Read only",
  write: "Write only",
  recipe_push: "Recipe push",
  grocery_write: "Grocery list write",
  admin: "Full admin",
};

// Never open to a key, whatever its access: secrets, sign-in, key management, restore
const NEVER = ["/api/settings", "/api/keys", "/api/auth", "/api/profile", "/api/import", "/api/dev"];
// Only for admin keys
const ADMIN_ONLY = ["/api/logs", "/api/backups", "/api/export", "/api/updates"];

// recipe_push: the routes that send recipes in (route patterns as Fastify matches them)
const RECIPE_PUSH = new Set(["POST /api/recipes", "POST /api/recipes/import", "GET /api/imports/:id"]);
// grocery_write: every route under here
const GROCERY = "/api/grocery";

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
const isRead = (method: string) => method === "GET" || method === "HEAD";

// path is the matched route pattern, e.g. "GET /api/recipes/:id" -> method "GET", path "/api/recipes/:id"
export function keyAllows(access: KeyAccess, method: string, path: string): boolean {
  if (NEVER.some((p) => under(path, p))) return false;
  if (ADMIN_ONLY.some((p) => under(path, p))) return access === "admin";
  switch (access) {
    case "admin":
      return true;
    case "read":
      return isRead(method);
    case "write":
      return !isRead(method);
    case "recipe_push":
      return RECIPE_PUSH.has(`${method} ${path}`);
    case "grocery_write":
      return under(path, GROCERY) && !isRead(method);
  }
}

export function keyDenied(access: KeyAccess, method: string): string {
  const label = KEY_ACCESS_LABELS[access];
  if (isRead(method) && access !== "read" && access !== "admin") return `This API key can't read (${label})`;
  return `This API key's access (${label}) doesn't allow this`;
}
