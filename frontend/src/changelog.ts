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
