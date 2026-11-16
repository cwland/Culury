# Grocery: bulk delete, archived lists, weekly default list (design)

Approved by Cory 2026-11-16 ("do it"). Release 1.2.0.

## Why
- Adding a recipe with lots of ingredients by mistake means deleting items one by one. Bulk delete fixes that.
- Shopping trips should be kept (archived) rather than only deleted, and old items brought back onto a new list.
- Lists are weekly: "Week of <Monday>" is the default whenever no list is named.

## Goals
1. **Edit mode** on the grocery page: a button at the top switches the list into select mode; tick items (checked or not); Delete selected removes them in one call. Not the same as checking off. The per-item pencil stays.
2. **Archive this list**: shown at the bottom next to Delete, always. Keeps the list as is (checked and unchecked items) and takes it off the tabs.
3. **Archived lists**: a button at the top opens a popup of archived lists (name, archived date, item count). Pick one → read-only view of all its items. **Add to a list**: tick which items (all ticked by default), pick a current list or a new one, add them (merged like any add).
4. **Default list**: when no list is named, items go to "Week of <this Monday>" (found by name among active lists, else created). Applies to POST /api/grocery/items (Home Assistant, Shortcuts, iOS app). In Add to grocery list from a recipe: no active lists → a new list named "Week of November 16" is suggested (editable); active lists → pick one or start a new one (name suggested the same way).

## Non-goals
- No editing of archived lists, no un-archive (bring items forward instead).
- No per-person time zone.

## Approaches
- **A. Archived flag (picked).** grocery_lists.archived_at; items stay in grocery_items; API refuses writes to items on archived lists; active list queries skip archived. Small, backups already cover it. Risk: every query must skip archived lists — covered by tests.
- B. Snapshot table, original deleted. Fully separate history, but a new table for backup/export/reset and copy logic. Not picked.
- Bulk delete: one POST call with ids (one transaction, one live event) instead of N DELETEs.

## Decisions
- Migration: grocery_lists.archived_at timestamptz null.
- "Keep at least one list" rule removed; zero active lists is a valid state. The page then offers to start "Week of <Monday>".
- "This Monday" = the Monday of today's week in the server's time zone (TZ), named "Week of November 16" (month name + day, no year).
- GET /api/grocery/lists returns active lists only; GET /api/grocery/lists?archived=1 returns archived ones (newest first, with archivedAt and counts).
- Item writes (add, patch, delete, clear-checked, bulk delete) on an archived list → 409. Moving an item to an archived list → 409. Reading items of an archived list is allowed.
- New routes: POST /api/grocery/items/delete {ids} → {deleted}; POST /api/grocery/lists/:id/archive; POST /api/grocery/lists/:id/bring-forward {itemIds, listId? | name?} → adds copies (checked = false) to the target list, merged with addToList.
- Live event "grocery" after each change.

## Left to the builder
- Exact layout of the edit-mode bar and archive popup, in the page's existing style.
- What's new entry and version bump to 1.2.0.
