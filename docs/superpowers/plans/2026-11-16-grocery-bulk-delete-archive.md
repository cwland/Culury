# Grocery bulk delete, archived lists, weekly default list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select-and-delete many grocery items at once, archive lists (read-only) and bring their items forward, and default to a "Week of <Monday>" list whenever no list is named.

**Architecture:** An `archived_at` column on grocery_lists; active-list queries skip archived lists and item writes on them return 409. New routes in `backend/src/routes/grocery.ts`; a pure `weekListName()` in `backend/src/lib/grocery.ts`. Frontend changes in `GroceryPage.tsx` (edit mode, archive button, archived popup) and `AddToListDialog.tsx`.

**Tech Stack:** Fastify + Drizzle + Postgres (Vitest, `setupTestApp`), React + Tailwind (Vitest + Testing Library, `src/test/fakeServer.ts`).

**Spec:** `docs/superpowers/specs/2026-11-16-grocery-bulk-delete-archive-design.md`

## Global Constraints
- List name format: `Week of November 16` (`en-US`, month long + day numeric, no year); Monday of today's week in the server's time zone.
- `GET /api/grocery/lists` stays a plain array (Home Assistant and the iOS app read it) and returns active lists only.
- Any write to an item on an archived list → 409 `"That list is archived"`.
- Every change emits live topic `"grocery"` via `changed(req, "grocery", listId)`.
- Release 1.2.0: bump `frontend/package.json`, `backend/package.json` and both lock files' version fields; add a What's new entry in `frontend/src/changelog.ts`.
- Check the Vitest exit code / "Errors" line, not just "Tests N passed".
- Cloud test DB: `service postgresql start`; `TEST_DATABASE_URL=postgresql://root:root@localhost:5432/culury_test`.

## Review Focus
- Bulk delete including a missing id (404) or an archived list's item (409) → whole call refused, nothing deleted. Test in Task 2.
- Moving an item (PATCH listId) onto an archived list → 409. Test in Task 2.
- Bring forward the same items twice → amounts merge onto the target list, not duplicate lines (addToList); bringing forward copies them as unchecked. Test in Task 3.
- Archiving the last active list → GET lists is `[]`, and a Home Assistant add then creates "Week of …". Test in Task 3.
- A week list that already exists but is archived → a new active one with the same name is created, not the archived one reused. Test in Task 3.

---

### Task 1: Week name helper and archived_at column

**Files:**
- Modify: `backend/src/lib/grocery.ts` (add `weekListName`)
- Modify: `backend/src/db/schema.ts:456-461` (add `archivedAt`)
- Create: `backend/drizzle/0021_grocery_archive.sql` (via `npm run db:generate` in backend)
- Test: `backend/tests/grocery.test.ts`

**Interfaces:**
- Produces: `weekListName(now?: Date): string`; `groceryLists.archivedAt: Date | null` (column `archived_at timestamptz`).

- [ ] **Step 1: Failing test** in `describe("aisles and matching")` sibling `describe("weekly lists")`:
```ts
it("names the list after this week's Monday", () => {
  expect(weekListName(new Date(2026, 10, 16, 9))).toBe("Week of November 16"); // Monday
  expect(weekListName(new Date(2026, 10, 22, 23))).toBe("Week of November 16"); // Sunday
  expect(weekListName(new Date(2026, 10, 23, 0, 30))).toBe("Week of November 23");
  expect(weekListName(new Date(2027, 0, 1))).toBe("Week of December 28"); // crosses the year
});
```
- [ ] **Step 2:** Run `npx vitest run tests/grocery.test.ts -t "weekly lists"` → FAIL (not exported).
- [ ] **Step 3:** Implement with local-date arithmetic (`(getDay() + 6) % 7` days back). Add `archivedAt: timestamp("archived_at", { withTimezone: true })` to groceryLists; `npm run db:generate`, rename the file to `0021_grocery_archive.sql` and its journal tag to match.
- [ ] **Step 4:** Run the grocery tests → PASS (migration applies in setup).
- [ ] **Step 5:** Commit `Grocery: week list name and archived_at`.

### Task 2: Active lists only, bulk delete, archived lists read-only

**Files:**
- Modify: `backend/src/routes/grocery.ts`
- Test: `backend/tests/grocery.test.ts`

**Interfaces:**
- Consumes: `groceryLists.archivedAt`.
- Produces: `POST /api/grocery/items/delete` body `{ ids: number[] }` (1–500) → `200 { deleted: number }`; `activeListOr404(id)` helper (404 missing, 409 archived) used by every item write.

- [ ] **Step 1: Failing tests** in `describe("grocery list")`:
  - `"deletes several items at once"`: add `"eggs, milk, bread"`, delete ids of eggs+milk → `{ deleted: 2 }`, items = `["bread"]`.
  - `"bulk delete is all or nothing"`: ids from listId plus a missing id 999999 → 404, nothing deleted; ids spanning two lists is allowed (each list gets a live event).
  - `"archived lists can be read but not changed"`: archive via `t.db` update `archived_at = now()` on a second list with an item; GET items → 200; POST items, PATCH item, DELETE item, bulk delete, clear-checked → 409; PATCH an item on the active list with `listId` = archived → 409; GET lists excludes it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: `GET /api/grocery/lists` adds `where(isNull(archivedAt))`; `activeListOr404`; item PATCH/DELETE look up the item's list first; bulk delete in one transaction, 404 if any id is missing, 409 if any is on an archived list, emits per distinct listId. `firstList` (still used until Task 3) filters active lists.
- [ ] **Step 4:** Run backend tests → PASS.
- [ ] **Step 5:** Commit `Grocery: bulk delete; archived lists are read-only`.

### Task 3: Archive, archived list view, bring forward, weekly default

**Files:**
- Modify: `backend/src/routes/grocery.ts`
- Test: `backend/tests/grocery.test.ts`

**Interfaces:**
- Consumes: `weekListName`, `activeListOr404`, `addToList(tx, listId, lines, by)`.
- Produces:
  - `POST /api/grocery/lists/:id/archive` → `200 { ...list, archivedAt }` (409 if already archived).
  - `GET /api/grocery/lists?archived=1` → `[{ id, name, archivedAt, open, done }]` newest archivedAt first.
  - `POST /api/grocery/lists/:id/bring-forward` body `{ itemIds: number[], listId?: number, name?: string }` (exactly one of listId/name; name creates a new active list) → `201 { listId, added, merged }`. Items must belong to `:id` (400 otherwise). Copies name/quantity/unit/note/sources; added unchecked.
  - `GET /api/grocery/this-week` → `{ name: string, listId: number | null }` (active list with that name, if any).
  - `weekList()` helper: active list named `weekListName()` or a new one at the end of sortOrder.
- [ ] **Step 1: Failing tests** (new `describe("archiving")`):
  - `"archives a list as is and lists it under archived"`: list with one checked + one open item; archive → GET lists lacks it; `?archived=1` shows `{ open: 1, done: 1 }`; archive again → 409.
  - `"brings chosen items forward onto a current or a new list"`: bring 1 of 2 items to listId → that item appears unchecked; again with `name: "Costco"` → new list "Costco" in GET lists; bringing the same item twice to one list merges (`merged: 1`).
  - `"the last list can be deleted or archived"`: delete the only list → 204; GET lists → `[]`.
  - Rewrite `"several lists; Home Assistant adds to the first one"` as `"Home Assistant adds to this week's list"`: POST /api/grocery/items with key → listId of a new list named `weekListName()`; second add → same listId; archive it, add again → a different new list with the same name.
  - `"says this week's list name"`: GET /api/grocery/this-week → `{ name: weekListName(), listId: null }`, then matches after an HA add.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the routes; remove the "Keep at least one list" check; `POST /api/grocery/items` uses `weekList()`; delete `firstList`.
- [ ] **Step 4:** Run all backend tests → PASS (fix `reset-app` / export tests only if they assumed list counts).
- [ ] **Step 5:** Commit `Grocery: archive lists, bring items forward, weekly default list`.

**Checkpoint: stop and show Cory the backend before the UI.**

### Task 4: Edit mode with bulk delete on the grocery page

**Files:**
- Modify: `frontend/src/components/grocery/GroceryPage.tsx`
- Create: `frontend/src/components/grocery/GroceryPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/grocery/items/delete`.
- Produces: in GroceryPage, an `Edit` button (aria-label "Select items to delete") at the top beside Email; in edit mode rows show a checkbox (role checkbox, aria-label `Select <name>`) instead of toggling checked; a bar with `Select all`, `Cancel`, and `Delete N items` (disabled at 0) asking "Delete N items?" with Delete / Keep them before calling.
- [ ] **Step 1: Failing tests** with fakeServer: `"selects several items and deletes them in one call"` (three items, Edit, tick two, Delete 2 items, confirm → one POST with both ids, edit mode closes); `"tapping a row in edit mode selects it, it doesn't check it off"` (no PATCH sent); `"the pencil still edits one item outside edit mode"`.
- [ ] **Step 2:** Run `npx vitest run src/components/grocery` → FAIL.
- [ ] **Step 3:** Implement (`ItemRow` gets `selecting`, `selected`, `onSelect` props; pencil hidden while selecting).
- [ ] **Step 4:** Run → PASS; run the whole web suite, exit code 0.
- [ ] **Step 5:** Commit `Grocery page: edit mode to delete several items`.

### Task 5: Archive button, archived lists popup, bring forward

**Files:**
- Modify: `frontend/src/components/grocery/GroceryPage.tsx` (Archive button next to `DeleteList`; `Archived lists` button at the top)
- Create: `frontend/src/components/grocery/ArchivedLists.tsx`
- Modify: `frontend/src/recipes.ts` (`GroceryList` gains `archivedAt?: string | null`)
- Test: `frontend/src/components/grocery/GroceryPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 routes.
- Produces: `ArchivedLists({ lists, onClose, onBrought })` popup. Screen 1: archived lists (name, "Archived Nov 16", "N items"), empty state "No archived lists yet". Screen 2: read-only items grouped by aisle (checked ones struck through), tick boxes all ticked, target select of active lists plus "New list…" (name field, prefilled with this week's name), `Add N items` → "Added N items to <list>" with Open the list.
- [ ] **Step 1: Failing tests:** `"archives the list and switches to another"` (Archive this list → confirm "Archive "X"? It will move to Archived lists." → POST archive; tabs drop it); `"no lists left offers this week's list"` (lists `[]` → button "Start Week of November 16" → POST lists with that name; name comes from GET this-week); `"opens an archived list read-only and brings chosen items forward"` (no pencils or row toggles; untick one; Add 1 item → POST bring-forward `{ itemIds:[...], listId }`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run web suite → PASS, exit 0.
- [ ] **Step 5:** Commit `Grocery page: archive lists and bring items forward`.

### Task 6: Add to grocery list suggests this week's list

**Files:**
- Modify: `frontend/src/components/grocery/AddToListDialog.tsx`
- Create: `frontend/src/components/grocery/AddToListDialog.test.tsx`

**Interfaces:**
- Consumes: `GET /api/grocery/this-week`, `POST /api/grocery/lists`.
- Produces: List select always shown with active lists plus "New list…"; no active lists → "New list…" selected with the name field prefilled `Week of November 16`; Add creates the list first, then adds.
- [ ] **Step 1: Failing tests:** `"no lists: suggests this week's list and creates it"` (POST lists `{ name: "Week of November 16" }` then POST items to its id); `"with lists: pick one or start a new one"` (select shows both lists + New list…; default the first).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Web suite → PASS, exit 0.
- [ ] **Step 5:** Commit `Add to grocery list: suggest this week's list`.

### Task 7: Release 1.2.0 and browser check

**Files:** `frontend/src/changelog.ts`, both `package.json` + lock files, `claude/culury-build-log.md` (project doc).

- [ ] **Step 1:** What's new 1.2.0 entry (edit mode delete, archive + bring forward, weekly lists; note: Home Assistant / iOS adds without a list go to this week's list). Bump versions.
- [ ] **Step 2:** Full backend + web suites, exit codes 0; `npm run build` in frontend and backend.
- [ ] **Step 3:** Chromium run (scratchpad e2e) at 1280×800 and 390×844: edit-mode delete, archive, bring forward, empty state, recipe Add to list with no lists; no sideways scroll, no page errors.
- [ ] **Step 4:** Commit `Release 1.2.0`, fetch + rebase onto origin/main, push. Update the build log.
