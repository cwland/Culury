# AI Enhance: design

Date: 2026-10-31 · Status: approved in chat, spec for review

## Goal

When a recipe is added, offer an AI check that corrects and fills gaps in it, and let the person review every change side by side before anything is saved. Covers instructions, ingredients, nutrition, and categories/tags.

## Decisions (from the conversation)

- **Save first, then offer.** A recipe always saves exactly as added (link, pasted text, photo, typed in). The recipe page then offers the check. No import path changes.
- **Asks on every new recipe** added one at a time. File imports (Paprika etc.) don't ask per recipe; every recipe page has an **AI check** button instead.
- **Accept per section** (four checkboxes), no per-line picking.
- **Instructions: fill gaps only.** Keep the recipe's own steps and wording; fix mistakes; add missing temperatures, doneness cues, times, pan sizes.
- **Only when AI is on** and the **AI Enhance** switch is on.

## How it works

### 1. The offer

- After a recipe is added, the recipe page opens with `?added=1` (link, paste and photo imports already open with `?imported=…`; the editor's first save adds `?added=1`).
- If AI is ready and AI Enhance is on, a card shows above the recipe: "Check this recipe with AI? It can fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags." Buttons: **Check with AI**, **Not now**.
- **AI check** button (a wand) sits with the recipe's other buttons on every recipe, when the feature is on.

### 2. The wizard

A wide window, opened by either button. While the AI works (usually 10–30 seconds): "Checking the recipe…". Then four sections, each with **Original** (left) and **AI suggestion** (right), changed lines highlighted, a short "What changed" list, and a **Use this** checkbox (ticked when something changed, unticked and labelled "No changes" when not):

1. **Instructions**: steps, changed/added text highlighted.
2. **Ingredients**: lines, changed/added highlighted.
3. **Nutrition**: per serving; the current numbers (or "none") vs the estimate.
4. **Categories and tags**: current vs suggested. Categories come from the household's own list; a category that doesn't exist yet is marked **new**. Tags: added ones highlighted, removed ones struck through, each with a short reason; existing tags are reused rather than near-duplicates.

Buttons: **Apply selected**, **Keep original**. On a phone the two columns stack (original above).

### 3. Undo

Applying saves a snapshot of the recipe's previous instructions, ingredients, nutrition, categories and tags. The recipe page then shows **Undo AI changes**, which restores the snapshot. One level of undo (the latest AI change).

### 4. The setting

**AI Enhance** switch in Settings › AI, shown only when AI is on; household-wide (owner-managed like the other AI settings). On by default once AI is set up. Off: no offer card, no AI check button, and the server refuses the check.

## Server

- `POST /api/recipes/:id/enhance` → asks AI (services in order, like recipe imports) and returns suggestions; **saves nothing**:
  `{ steps: { suggested: string[], changes: string[] }, ingredients: { suggested: string[], changes: string[] }, nutrition: { suggested: Nutrition|null, changes: string[] }, organize: { categories: string[], newCategories: string[], tags: string[], changes: string[] } }`
  409 when AI or AI Enhance is off; 502 with a reason when the AI's answer can't be used (and logged, as now).
- `POST /api/recipes/:id/enhance/apply` `{ steps?, ingredients?, nutrition?, categories?, tags? }` → snapshot, then save only the sections sent. New categories are created.
- `POST /api/recipes/:id/enhance/undo` → restore the snapshot, then delete it. 404 when there's none.
- Recipe JSON gains `aiSnapshotAt` (when there's something to undo) so the page can show **Undo AI changes**.
- Storage: table `recipe_snapshots` (`recipe_id` unique, `data` jsonb, `created_at`), included in backups/exports.
- Feature switch: `aiEnhance` joins `ai` and `apiKeys` in `features`.

AI prompt rules: JSON only; keep the original wording; change a step only to fix it or add a missing detail; ingredients may gain only items the steps use; never change quantities without a reason in `changes`; categories chosen from the provided list, new ones only if nothing fits; tags lowercase, reuse provided tags.

## Testing (test-first)

Backend, with the fake AI service:
- check returns suggestions and changes nothing in the recipe
- apply saves only the sections sent, creates new categories, stores a snapshot; undo restores it and removes the snapshot
- refused (409) when AI is off or the AI Enhance switch is off; an unreadable answer → 502 and a log entry

Screens (fake server at the fetch level):
- the offer card shows on a newly added recipe only when AI is ready and the switch is on; **Not now** hides it
- the wizard shows original vs suggestion per section, and **Apply selected** sends only the ticked sections
- **Undo AI changes** appears after applying and calls undo

Then one run in a real browser against a fake OpenAI-compatible AI.

## Out of scope

Per-line accepting, editing the suggestion before applying, multi-level history, running AI Enhance automatically.
