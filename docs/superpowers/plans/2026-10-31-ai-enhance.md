# AI Enhance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a recipe is added, offer an AI check whose suggestions (instructions, ingredients, nutrition, categories/tags) the person reviews side by side and applies per section, with undo.

**Architecture:** Recipes save as before. A new server module asks AI for suggestions (saves nothing), applies chosen sections after snapshotting the recipe, and undoes from the snapshot. The recipe page shows an offer card on newly added recipes and an AI check button; a wizard window shows original vs suggestion. A household switch `aiEnhance` gates it all.

**Tech Stack:** Fastify 5, Drizzle/PostgreSQL, zod, vitest (backend, real DB + fake AI); React 18, Testing Library + jsdom (frontend, fake server at fetch); Playwright for the browser run.

**Spec:** `docs/superpowers/specs/2026-10-31-ai-enhance-design.md`

## Global Constraints

- Only when AI is ready (`ai.active()` non-null) **and** feature `aiEnhance` is on; otherwise the API answers 409 and the UI shows nothing.
- Checking never writes to the recipe. Only `/enhance/apply` and `/enhance/undo` change it.
- Accepting is per section: `steps`, `ingredients`, `nutrition`, `organize` (categories + tags).
- Instructions: "fill gaps only": keep the recipe's own steps and wording.
- AI is asked through `ai.ask("recipe", …)` (services in order, as recipe imports).
- One level of undo (latest AI change), stored in `recipe_snapshots`, included in backups.
- `aiEnhance` default: on once AI is set up (same rule as `ai` in `features.ts` defaults).
- Copy: offer card text "Check this recipe with AI? It can fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags." Buttons **Check with AI**, **Not now**, **AI check**, **Apply selected**, **Keep original**, **Undo AI changes**, section checkbox **Use this**.

## Review Focus

- The AI returns a section missing or empty (e.g. no `steps`): that section shows "No changes", unticked; others still work. → test in Task 2.
- The AI suggests a tag that exists with different capitals (`Chicken` vs `chicken`): reuse the existing tag, no duplicate. → test in Task 3.
- Apply while a second AI apply already happened: snapshot is replaced by the newer one; undo goes back one step only. → test in Task 3.
- Recipe deleted while the wizard is open: apply answers 404, wizard shows the message, nothing crashes. → test in Task 3.
- AI times out or is unreadable: wizard shows the error with a **Try again** button; nothing saved. → test in Task 5.

---

### Task 1: Switch and storage

**Files:**
- Modify: `backend/src/lib/features.ts` (FEATURES += `"aiEnhance"`, default like `ai`), `backend/src/routes/features.ts` (schema + `NAMES.aiEnhance = "AI Enhance"`), `backend/src/db/schema.ts` (table `recipeSnapshots`), `backend/src/lib/dataExport.ts` (DATA_TABLES entry), `backend/tests/helpers.ts` (truncate list), `frontend/src/components/FeatureSwitch.tsx` (`Feature` type)
- Create: migration via `npx drizzle-kit generate --name recipe_snapshots`
- Test: `backend/tests/features.test.ts`

**Interfaces:**
- Produces: feature key `aiEnhance`; table `recipe_snapshots(recipe_id int unique references recipes on delete cascade, data jsonb not null, created_at timestamptz default now())`; type `RecipeSnapshot = { steps; ingredients; nutrition; categoryIds: number[]; tags: string[] }`.

- [ ] Step 1: failing test `it("AI Enhance follows AI: on once AI is set up, and can be switched off")`: GET features → `aiEnhance: false`; PUT AI settings with one service → `aiEnhance: true`; PUT `{ aiEnhance: false }` → false.
- [ ] Step 2: run `npx vitest run tests/features.test.ts` → FAIL (`aiEnhance` undefined).
- [ ] Step 3: implement; generate migration.
- [ ] Step 4: run → PASS; `npx tsc --noEmit` clean.
- [ ] Step 5: commit "AI Enhance: switch and snapshot table".

### Task 2: Ask AI for suggestions (saves nothing)

**Files:**
- Create: `backend/src/lib/enhance.ts`
- Modify: `backend/src/routes/ai.ts` (route)
- Test: `backend/tests/enhance.test.ts`

**Interfaces:**
- Produces: `suggestEnhancements(db: Db, ai: AiService, recipeId: number): Promise<Enhancement>` where
  `Enhancement = { steps: Section<string[]>; ingredients: Section<string[]>; nutrition: Section<Nutrition | null>; organize: { categories: string[]; newCategories: string[]; tags: string[]; changes: string[]; changed: boolean } }`, `Section<T> = { suggested: T; changes: string[]; changed: boolean }`.
- `changed` = suggestion differs from the current recipe (compare trimmed lines / sets / numbers).
- Route `POST /api/recipes/:id/enhance` → `Enhancement`; 409 if AI off or `aiEnhance` off; 404 unknown recipe; AiError → 502 (existing `asHttp`).
- Prompt sends: title, servings, ingredient lines, steps (with `#` headings), current nutrition, current category names, current tags, the household's category list, and existing tag names (top 200). Rules from the spec's "AI prompt rules".

- [ ] Step 1: failing tests (fake AI returns a full JSON reply):
  - `it("suggests fixes for each section and changes nothing in the recipe")`: recipe "Chili" (steps `["Cook the chicken."]`); fake reply sets `steps: ["Cook the chicken until it reaches 165°F, about 6 minutes a side."]`; response `steps.changed === true`, `steps.changes.length > 0`; GET recipe afterwards still has the original step.
  - `it("a section the AI leaves out shows no changes")`: reply without `nutrition` → `nutrition.changed === false`, `nutrition.suggested` equals current (null).
  - `it("categories come from yours; a new one is marked")`: household has Dinner; reply categories `["Dinner","Soup"]` → `categories: ["Dinner","Soup"]`, `newCategories: ["Soup"]`.
  - `it("is refused when AI Enhance or AI is off")`: PUT `{ aiEnhance: false }` → 409; AI off → 409.
- [ ] Step 2: run → FAIL (404 route).
- [ ] Step 3: implement `suggestEnhancements` + route.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit.

### Task 3: Apply and undo

**Files:**
- Modify: `backend/src/lib/enhance.ts`, `backend/src/routes/ai.ts`, `backend/src/lib/recipes.ts` (`loadRecipe` adds `aiSnapshotAt: string | null`)
- Test: `backend/tests/enhance.test.ts`

**Interfaces:**
- Produces: `applyEnhancements(db, recipeId, body: { steps?: string[]; ingredients?: string[]; nutrition?: Nutrition | null; categories?: string[]; tags?: string[] }, userId): Promise<void>` (snapshot then `saveRecipe` with only given fields; categories by name via existing `refIds`, which creates new ones); `undoEnhancements(db, recipeId): Promise<void>`.
- Routes: `POST /api/recipes/:id/enhance/apply` → recipe JSON; `POST /api/recipes/:id/enhance/undo` → recipe JSON; 404 when no snapshot / no recipe.

- [ ] Step 1: failing tests:
  - `it("applies only the sections sent and keeps the original for undo")`: apply `{ steps: [...] }` only → steps changed, ingredients untouched, `aiSnapshotAt` set.
  - `it("undo puts it back and removes the snapshot")`: after undo, original steps; `aiSnapshotAt === null`; second undo → 404.
  - `it("new categories are created; a tag differing only in capitals reuses the existing one")`: apply `{ categories: ["Soup"], tags: ["Chicken"] }` with tag `chicken` existing → categories include Soup, tags `["chicken"]`, tag count unchanged.
  - `it("a second apply replaces the snapshot: undo goes back one step")`.
  - `it("applying to a deleted recipe answers 404")`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS, then full backend suite `npx vitest run` → all pass.
- [ ] Step 5: commit.

### Task 4: Settings switch

**Files:**
- Modify: `frontend/src/components/AiSettings.tsx` (a card using the existing `SettingCard` + `Toggle`, saving via `PUT /api/settings/features { aiEnhance }`), `frontend/src/ai.ts` (`AiStatus` gains `enhance: boolean`), `backend/src/lib/ai.ts` `status()` returns `enhance: ready && isOn("aiEnhance")`
- Test: `frontend/src/components/AiSettings.test.tsx`, `backend/tests/ai-features.test.ts` (status)

- [ ] Step 1: failing tests: backend `status` includes `enhance`; frontend `it("AI Enhance switch saves right away")` → clicking switch "AI Enhance" sends `PUT /api/settings/features { aiEnhance: false }`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit.

### Task 5: The wizard

**Files:**
- Create: `frontend/src/components/recipes/EnhanceWizard.tsx`, `frontend/src/components/recipes/EnhanceWizard.test.tsx`
- Modify: `frontend/src/recipes.ts` (types `Enhancement`, `Recipe.aiSnapshotAt`)

**Interfaces:**
- Consumes: `POST /api/recipes/:id/enhance`, `/enhance/apply` (Tasks 2–3).
- Produces: `<EnhanceWizard recipe={Recipe} onClose={() => void} onApplied={(r: Recipe) => void} />`.
- Layout: `Popup` wide+tall; four `<section aria-label="Instructions|Ingredients|Nutrition|Categories and tags">`, two columns (`Original`, `AI suggestion`; stacked under `sm`), lines not present in the original get `<mark>`; removed tags `<s>`; checkbox label **Use this** (default = `changed`); "No changes" when not changed.

- [ ] Step 1: failing tests:
  - `it("shows original and suggestion side by side for each section")`.
  - `it("Apply selected sends only the ticked sections")`: untick Nutrition → apply body has `steps`, `ingredients`, `categories`, `tags`, no `nutrition`; `onApplied` called.
  - `it("a section with no changes is unticked and says so")`.
  - `it("when the AI fails it says why and Try again asks again")`: first enhance → 502 `{error:"…couldn't be read…"}`; message shown; click **Try again** → second request.
- [ ] Step 2: run → FAIL (module missing → add empty component first so tests fail, not error).
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit.

### Task 6: Offer card, AI check button, undo on the recipe page

**Files:**
- Modify: `frontend/src/components/recipes/RecipeView.tsx`, `frontend/src/components/recipes/RecipeEditor.tsx` (new recipe → `#/recipes/<id>?added=1`)
- Test: `frontend/src/components/recipes/RecipeView.test.tsx`, `RecipeEditor.test.tsx` (update hash expectation)

- [ ] Step 1: failing tests:
  - `it("a newly added recipe offers the AI check when AI Enhance is on")` (hash `?added=1` or `?imported=1`, status `{ready:true, photos:false, enhance:true}`) → card with the spec copy; **Not now** hides it.
  - `it("no offer and no AI check button when AI Enhance is off")`.
  - `it("AI check opens the wizard")`.
  - `it("Undo AI changes shows after applying and puts the original back")` (recipe with `aiSnapshotAt` → button → `POST /enhance/undo`).
  - editor test: new recipe saves → `#/recipes/42?added=1`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; full frontend `npm test` and backend suites pass.
- [ ] Step 5: commit.

### Task 7: Real browser, docs, push

- [ ] Step 1: fake OpenAI-compatible AI at `/tmp/claude-0/fakeai/server.cjs` answers the enhance prompt; run a Playwright script: add a recipe by hand → card → Check with AI → wizard (screenshot desktop + phone) → untick one section → Apply → Undo. Expect no page errors, applied sections changed, undo restores.
- [ ] Step 2: README "AI" section + changelog entry (0.9.0), versions bumped in three package.json files.
- [ ] Step 3: full suites + `npm run build`; commit; push; give the user the pull commands.
