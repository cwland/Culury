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
    version: "1.0.0",
    date: "2026-11-14",
    title: "Culury 1.0: the first release",
    changes: [
      "Culury is now version 1.0, its first full release: recipes, importing, Cook Mode, meal plans, grocery lists, sharing and AI help all in one place.",
      "Nutrition for a recipe with no servings set is now for the whole recipe (1 serving), instead of a quarter of it. The AI is told the same, so the serving size matches the numbers. Press Re-calculate nutrition on older recipes without servings to update them.",
    ],
  },
  {
    version: "0.17.3",
    date: "2026-11-14",
    title: "Nutrition answers don't run out of room",
    changes: [
      "Calculate nutrition could fail with “the answer couldn't be read (it ran out of room)”, even for a short recipe: models that think before answering used up the room. Nutrition now leaves at least twice as much room, and OpenRouter models are asked to keep their thinking short.",
    ],
  },
  {
    version: "0.17.2",
    date: "2026-11-13",
    title: "Recipes show when you open Culury",
    changes: [
      "Opening Culury while already signed in showed a blank page until you went to another section and back. Your recipes now show straight away.",
    ],
  },
  {
    version: "0.17.1",
    date: "2026-11-10",
    title: "Importing says what it's doing",
    changes: [
      "Import never looks like it did nothing: the button says Uploading Chili.pdf… straight away and can't be pressed twice, then a line under it says what's happening (Reading Chili.pdf with your AI…).",
      "Any problem shows in red right under the button: the upload was refused, nothing was found, or Culury stopped answering while it checked (the import may still finish).",
      "PDFs: recipes whose ingredients the AI wrote in groups or in parts (amount, unit, name) are imported instead of being dropped, and when the AI finds a recipe without ingredients it says so.",
      "When a PDF gives no recipes, Settings › Logs keeps what the AI answered, so it can be looked into.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-11-09",
    title: "Discover previews, substitutions, a shorter setup, and grams",
    changes: [
      "Discover: click a feed item to preview its ingredients and steps; nothing is saved until you press Import, which opens the AI check. Click tags to filter, and work out nutrition per ingredient right there.",
      "Setup is short pages that never scroll. Choose an AI, then Validate your key or address: the model list fills in with the best one for Culury already picked, and a line says which models work well.",
      "Substitutions: swap an ingredient (pick it from the recipe as you type) or add an item, with an amount and unit. Tick the ones you like and Make a new version with these changes.",
      "Sort ingredients A to Z (Settings › Recipes), on the recipe page and in Cook mode.",
      "Metric shows grams for dry ingredients, like ≈240 g flour (2 cups), from a table of common ingredients or your AI's estimate. US shows cups for grams it knows.",
      "Nutrition: Calculate nutrition opens a window that says what it's doing, calories are listed per ingredient, and a note says when the recipe changed since.",
      "Share has two tabs, Link & downloads and Email. Shared emails link to every download format, and the public page opens ready to download.",
      "Settings: AI Enhance and Auto nutrition are in Recipes (on with your first AI setup); choose how often to check for updates; Delete data can delete just the recipes or reset the whole app; things that need email say so when it isn't set up.",
      "Fixes: a one-recipe Paprika file gets the AI check; Improve all automatically on a file closes the window and shows progress at the top; picking the same file twice works; runs on older CPUs; database passwords with symbols work.",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-11-01",
    title: "Setup wizard, a simpler AI check, and tidier settings",
    changes: [
      "A setup wizard on first sign-in: your name, measurements, a passkey, email and AI (each with a test that has to pass before you go on), AI preferences and the starting categories. Members get the short version. Then a Getting started tour, also in the account menu.",
      "Improve with AI never adds ingredients any more (no more surprise salt and pepper): it only corrects and tidies the ones the recipe has.",
      "The AI check is one change at a time: Accept change or Reject change, both move on, Prior goes back. The pencil edits the AI's suggestion before you accept it. The last choice saves and says Recipe added (or updated).",
      "Fresh herbs show the dried amount beside them, like (1 tsp dried), scaled with the recipe. Sprigs and bunches get an estimate.",
      "A file with several recipes (a Paprika export, a PDF) lists them A–Z first: untick the ones you don't want, choose how to check them, then Accept. Improve all automatically runs in the background, with a pill at the top of every screen showing how far it's got.",
      "Editing a recipe hides the buttons, tags and categories until you save; the rating sits above Save and Cancel; clicking anywhere else closes the editor (it asks first if you changed something).",
      "Settings › Recipes › Organize: categories, collections, tags and meal plan rows as tabs of chips instead of long lists. Sort categories and collections A–Z, Z–A or Manual, and drag the chips into order.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-11-01",
    title: "Share links, downloads and a new Share window",
    changes: [
      "Every recipe has a public read-only link (Share › Public link). Anyone with it sees the recipe without signing in: photo, ingredients with scaling and units, steps and nutrition. The recipe's notes, your ratings and who added it stay private. New link replaces a link that spread too far; Settings › Recipes › Public share links turns them all off.",
      "Download a recipe as a PDF (made by Culury, with the photo and nutrition), JSON-LD, Paprika, Meal-Master or CookML, from Share or from the public page.",
      "The Share window: Copy link, Share… (your phone's or Mac's share sheet), Mail app, and Send from Culury, each with an optional file attached. The email is new: the photo, the times and a big Open the recipe button, with the recipe underneath.",
      "Share links show the recipe's title, summary and photo when pasted into Messages, WhatsApp or Slack.",
      "On the recipe page, As written is now As is, on the same line as the servings.",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-11-01",
    title: "Recipes from sites that block imports",
    changes: [
      "A link import now says why a site kept the recipe from Culury: a security check (CAPTCHA, by Cloudflare, reCAPTCHA, hCaptcha or AWS WAF), a paywall, or a refusal. Sites that are marked paywalled but still carry the recipe in the page, like America's Test Kitchen, import as before.",
      "When a site blocks an import, Culury looks for a saved copy on the Wayback Machine, then archive.ph. The import window says where it's looking, and the recipe page says which archive and date the recipe came from. The recipe keeps its own link. Turn it off in Settings › Recipes › Saved copies.",
      "When nothing works, the import window says so and offers what's left: open the archive's security check or the recipe's page yourself, Paste the recipe, From a photo, or a Blank recipe with the link filled in.",
      "Send to Culury: a bookmark (Settings › Recipes) that sends the recipe page you have open to Culury, past a security check or a paywall you're signed in to. Culury asks before importing it.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-10-31",
    title: "PDF imports and a step-by-step AI review",
    changes: [
      "Import PDFs: a single recipe or a whole cookbook, from From a file or From a photo. Pages with text are read in parts; scanned pages are sent to your AI as pictures. Reading a PDF needs AI.",
      "Improve with AI is now a wizard: one screen at a time (ingredients, instructions, nutrition, categories and tags), the recipe's name always at the top, and a summary of your choices before Save. It opens by itself after you import a recipe.",
      "After a file brings in several recipes, choose Review one by one (the wizard goes through each, remembers where you got to, and you can stop any time) or Improve all automatically (the AI fixes them all in the background, with a progress page, a Stop button and a list of any it couldn't do). Every original stays as v1 in its Version history.",
      "Settings › Data › Wipe all recipes: removes every recipe with its versions, photos, tags, collections and meal plan entries, for a clean slate. Type DELETE to confirm; a backup is saved first.",
      "Icons have hover text, Add to grocery list is back with the buttons in front of Organize, and the edit pencils sit right next to Ingredients, Steps and Notes.",
    ],
  },
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
