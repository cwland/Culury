# Recipe list: card/list view and tiles across (1.1.0)

Cory's ask: next to the search on Recipes, an icon to switch between card and list view, and − / + to change how many tiles go across instead of the fixed 2/3/4; default 4; the choice sticks; pictures and text resize so nothing is cut off.

- Approach (approved): browser setting (localStorage `culury-recipe-view`, `{mode, across}`), so phone and Mac can differ. Saving per account was considered and not chosen.
- Cards: 2–6 across, default 4. Phones always 2; the picked number applies as width allows (sm ≤3, md ≤4, then 5/6 at lg/xl). − / + hidden on phones and in list view.
- Scaling: each card is a CSS container; title 14/16/18 px and details 11/12/14 px at tile widths <12rem / ≥12rem / ≥20rem; photo stays 4:3; title keeps two lines.
- List: thumbnail, title (one line, truncated), time, stars, source, pin/favorite.
- Code: `frontend/src/components/recipes/recipeView.ts` (load/save/gridClass), `ViewControls` and `RecipeRow` in RecipeList.tsx.
