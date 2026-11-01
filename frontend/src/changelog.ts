// "What's new": one entry per version, newest first. Add an entry (and bump "version" in
// package.json) with each release; everyone sees it once after signing in, and any time from the
// version number in the bottom left.
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title?: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.12.0",
    date: "2026-10-31",
    title: "A tidier recipe page, edited in place",
    changes: [
      "Edit right on the recipe: the pencil by the name edits the details, and Ingredients, Steps and Notes each have their own pencil. Only that part opens; Save asks whether it's a new version. The separate edit screen is gone.",
      "Fewer buttons: Share and Delete are icons next to Start cooking, favorite and pin are icons by the name, and Organize sets categories, collections and tags in one place. The AI check is now Improve with AI. Tags and collections show under the buttons.",
      "Add to grocery list moved into Ingredients, and it adds the size you scaled to, including recipes that only say what they make (2× the cookies, twice the flour).",
      "Scaling is a − 1× + stepper (or − 4 servings +), with a small reset icon that doesn't push the units around.",
      "Ingredient amounts written in words now scale: “One pound of ground Italian sausage” is read as 1 lb, and imports and AI write numbers. A comma inside brackets no longer splits a name, and “to taste”, “for garnish” and “optional” are notes.",
      "Nutrition: Re-analyze with AI and Edit are icons at the top of the panel.",
      "Settings tabs all load when Settings opens, so switching between them is instant.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-31",
    title: "Recipe versions",
    changes: [
      "Every recipe keeps its versions. An import or a new recipe is v1, and an AI check that changes the steps or ingredients saves a new version.",
      "When you edit a recipe, Save asks: save to the current version, or save as a new version (so the recipe as it was stays). Changing only tags, categories or the photo saves straight away.",
      "Recipe pages have tabs: Active recipe, Nutrition (everything nutrition, moved here) and Version history, which lists each version with its date, who made it and what changed. Set any version active again, or delete ones you don't need.",
      "Undo AI changes is gone: go back with Set active on the version from before. Recipes that could be undone already have that version.",
      "Switch versioning off in Settings › Recipes: edits then save over the recipe without asking, and the versions you have are kept.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-31",
    title: "Nutrition that keeps up",
    changes: [
      "Auto nutrition (Settings › AI): nutrition is worked out by itself, for a new recipe once its AI check is done or skipped (straight away if the AI check is off), and again whenever its ingredients change. The Nutrition panel says “Updating nutrition…” while it works and shows the new numbers when it's done, on every device.",
      "Numbers you typed in are never replaced. When the ingredients change, the panel says the numbers are out of date and offers Estimate again.",
      "Added sugars, like on a US label (“Includes 12 g added sugars”, with its daily value), and the serving size (“About 1½ cups (340 g)”). AI estimates both; you can type them in too.",
      "The points estimate counts only added sugar when it's known, so fruit and milk sugar don't add points.",
      "The import window no longer lists recent imports: every import is in Settings › Logs › Imports, now including links that were already saved.",
    ],
  },
  {
    version: "0.9.2",
    date: "2026-10-31",
    title: "AI check: slow home AI, handled",
    changes: [
      "The AI check reads the answer as the AI writes it, so you see “Home AI is thinking…” and then “Home AI is writing… 420 words”.",
      "A slow home AI is no longer cut off after 3 minutes: Culury waits as long as it keeps writing, and only gives up if it goes quiet for a minute (or never starts). The message says which.",
      "Skip button: while an AI service is working and you have another one, “Skip Home AI” stops it (your AI server stops too) and asks the next service.",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-10-31",
    title: "AI check: fuller steps and live progress",
    changes: [
      "AI check now expands brief steps into full instructions: grouped under headings (Prep, Sear, Sauce…), each with a bold label and the how and why: heat level, times, doneness cues. Detailed recipes still only get gaps filled. Unsafe doneness temperatures are raised to the USDA minimum, and it says so.",
      "While the AI works you see what's happening: which AI service it's asking (with a timer), a switch to your backup service if one doesn't answer, and what it found in each part.",
      "Steps that start with a short label (“Pat dry: …”) show the label in bold on the recipe and in Cook Mode.",
      "Adding a home AI that thinks before answering (like qwen3-vl) no longer fails its test with an empty answer.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-31",
    title: "AI Enhance and Paprika import",
    changes: [
      "AI Enhance: after you add a recipe, Culury offers to check it with AI. It fills gaps in the steps (times, temperatures, doneness), catches missing ingredients, estimates nutrition and suggests categories and tags. You see the original and the suggestion side by side and keep only the parts you want. Undo AI changes puts it back. Any recipe has an AI check button too; turn it off in Settings › AI.",
      "Add a recipe › From a file: import your whole Paprika collection (.paprikarecipes), with photos, categories, ratings and notes. Recipes you already have are skipped.",
      "Browsing: click a tag or category again to turn it off, pick several tags at once, and find recipes with no category or no tags.",
      "All recipe cards are the same size.",
      "Settings › AI: the (i) next to AI services suggests models that work well, at home and paid.",
      "Fixes: saving a recipe typed in by hand, pressing Enter in the editor, finishing Cook Mode, and clearer messages when the connection drops.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-30",
    title: "Sharing and backups with photos",
    changes: [
      "Share on any recipe: email it (a nicely laid-out email with an optional note), print it or save it as a PDF, or download it as a recipe file (schema.org JSON-LD) that other recipe apps import.",
      "Email the grocery list from the Grocery page: what's left to get, by aisle.",
      "Meal plan email (Settings › Profile): each day at the time you pick, today's and tomorrow's meals, and anything to start ahead (“soak the beans overnight”). Set TZ in your .env so the time is right.",
      "Backups now include your recipe photos: they're .tar.gz files, saved daily and kept as before. Restore one in Settings › Data (older .json backups still restore). Export has “Everything with photos” too.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-30",
    title: "More AI: photos, nutrition and meal ideas",
    changes: [
      "Add a recipe › From a photo: take a picture of a recipe card (handwriting is fine), a cookbook page or a screenshot, up to 4 photos of one recipe. If a photo shows the finished dish, it becomes the recipe's picture.",
      "Nutrition facts on every recipe, per serving with % daily values: read from the recipe's site when it has them, estimated by AI, or typed in. Includes a points-style estimate.",
      "Meal ideas (Meal plan › Week ▾, and the Pantry): AI suggests meals from what's in your pantry, your own recipes and what you haven't had lately. Put one on the plan with a tap.",
      "Grocery items the app can't place (gochujang, furikake…) are sorted into an aisle by AI, and remembered. Move an item to another aisle yourself and that's remembered too.",
      "Settings › AI: choose which service does what. Mark a cheap, fast model for quick jobs (sorting, nutrition, ideas) and the ones that can read photos.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-30",
    title: "Grocery list and pantry",
    changes: [
      "Grocery list: type or paste what you need (“eggs, 2 lb chicken thighs, milk”) and it's sorted by store aisle. Tap to put things in the cart.",
      "Add to grocery list from any recipe (at the servings you chose) or from the meal plan's Week menu. The same thing from different recipes is added up, so it's one line: 1 lb + ½ lb ground beef is 1½ lb.",
      "Before anything is added you see the list: what's in your pantry starts unticked, and staples (salt, oil, spices) are never added.",
      "Everyone in the household sees the list change as it happens, so two people can shop from it at once. The meal plan updates live too.",
      "Make more lists (Costco, Farmers market) and move items between them.",
      "Pantry: what you have at home, with use-by dates. When you finish shopping, put what's in the cart into the pantry with one tap.",
      "Cook with what you have: the pantry shows which recipes you can make, and what you'd still need.",
      "Home Assistant and other apps can add to the list with a Grocery API key (POST /api/grocery/items).",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-30",
    title: "Meal plan and household",
    changes: [
      "Meal plan: a week of breakfasts, lunches, dinners and snacks. Drag recipes onto days from the list beside it, drag dishes between days, or tap + to add a recipe or a note (Leftovers, Eat out).",
      "Tap a planned dish to open it, start cooking, change its servings or note, or move it. Copy last week into this one, or clear a week.",
      "Choose your meals (add Brunch, rename Snack…) and whether weeks start on Monday or Sunday in Settings › Recipes.",
      "Household: add the people you live with in Settings › Household, with a password or an emailed invite. Everyone shares the recipes and the plan; favorites, ratings, notes and sign-in are each person's own.",
      "The owner looks after the server (email, AI, API keys, backups, logs) and the household; members don't see those settings.",
      "Forgot password? now asks for your username or email, so it works for everyone in the household.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-30",
    title: "Cook Mode",
    changes: [
      "Start cooking from any recipe: one big step at a time, with Back and Next (or swipe, or the arrow keys).",
      "The screen stays on while you cook (on https:// addresses).",
      "Ingredients are a checklist beside the steps (a drawer on phones), and the ones each step uses light up.",
      "Times in steps are buttons: tap “simmer for 15 minutes” to start a timer. Timers keep running when you leave Cook Mode or reload, and chime, buzz and notify you when they're done.",
      "Change the servings (or ½×, 2×, 3×) and every amount follows, on the recipe page and in Cook Mode.",
      "Show amounts as written, in metric or in US units. Oven temperatures in the steps switch too (350°F → 175°C).",
      "Cook Mode remembers where you were for a few hours.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-30",
    title: "Import",
    changes: [
      "Add recipe › From a link: most recipe sites import as they are (their schema.org recipe data), with the photo saved here. Other pages, and TikTok, Instagram or YouTube videos, are read by your AI service.",
      "Add recipe › Paste the recipe: with Ingredients and Instructions headings it's read straight away; anything else goes to your AI service.",
      "Already have it? Importing the same page again opens the one you saved (or keeps another copy if you ask).",
      "Imports run in the background, so a slow site or AI never freezes the app. Recent imports, and why one didn't work, show in the Add recipe window and in Settings › Logs › Imports.",
      "Photos: add or change a recipe's photo from its page (click or drop a file) or in the editor. Photos are resized and kept on your server.",
      "On Android, share a link to Culury (once it's installed from the browser menu) to import it.",
      "API: POST /api/recipes/import with a url or text, and \"wait\" for the answer in one request (handy for iOS Shortcuts).",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-30",
    title: "Recipes",
    changes: [
      "Your recipe box: add recipes by typing or pasting them. Ingredients are read into amount, unit and name (1½ cups flour, sifted), with headings like “For the sauce:”.",
      "Search everything as you type: titles, ingredients, tags, notes and your own notes. Press / to jump to the search box.",
      "Categories (Breakfast, Dinner, Dessert…), collections in your own order (Quick Meals, Ninja CREAMi…) and tags. Manage them in Settings › Recipes.",
      "Favorites, pin to top, a 1–5 rating and private notes are yours alone; the recipe's own notes are for everyone.",
      "Substitution history: note what you swapped (sour cream → Greek yogurt) and how it went.",
      "Duplicate a recipe to make your own version.",
      "API: recipes, tags, categories and collections are in /api/docs. A Recipe push key can send recipes in from iOS Shortcuts or a browser extension.",
      "Recipes are included in backups and restore.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-30",
    title: "First version",
    changes: [
      "Culury's foundation: sign in with a password, passkeys (Touch ID, Face ID, Windows Hello) or OAuth / OpenID Connect (Authentik, Authelia, Google, GitHub…).",
      "Signed-in devices with per-device sign out, sign-in history, and password reset by email or from the server.",
      "API keys with an access type: Read only, Write only, Recipe push, Grocery list write or Full admin.",
      "AI services (OpenAI, Claude, Gemini, OpenRouter, or a home AI like Ollama), with backups that take over when one is down.",
      "Email (SMTP) settings with a test email, Logs, daily backups with restore, and a bar when a new version is out.",
      "Five color themes and light or dark mode, in Settings › Profile › Appearance.",
      "Recipes, the meal plan, grocery lists and the pantry are coming next.",
    ],
  },
];

// "0.10.0" > "0.9.2"
export function isNewer(a: string, b: string | null | undefined) {
  if (!b) return true;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
