# Culury

**Your recipes, meal plans and groceries, self-hosted.** A recipe manager for the homelab: import from any site, a photo or a handwritten card, cook step by step, plan the week, and shop from one shared list. AI is optional and can run on your own hardware.

## Status

Built in steps:

| Step | What | Status |
|---|---|---|
| 1 | Foundation: sign-in (password, passkeys, OAuth), devices, API keys with scopes, AI services with failover, email, logs, backups, themes + dark mode, Docker, CI | **Done** |
| 2 | Recipes: database, add/edit, ingredient parsing, tags, categories, collections, favorites, ratings, notes, substitutions, full-text search | **Done** |
| 3 | Import: schema.org JSON-LD, AI fallback, pasted text, background jobs, photo uploads, Android share | **Done** |
| 4 | Cook Mode: wake lock, step by step, ingredient checklist, tap-to-start timers, servings scaling, metric/US units | **Done** |
| 5 | Meal planner (drag and drop week, custom meal slots) and household members (owner / member) | **Done** |
| 6 | Grocery lists and pantry, household sync | **Done** |
| 7 | More AI: photos and handwriting, nutrition, aisle sorting, meal ideas, model cascading | **Done** |
| 8 | Sharing and export (HTML email, JSON-LD, PDF), photos in backups, meal plan emails | **Done** |

The version is in `backend/package.json` and `frontend/package.json` (keep them the same); "What's new" notes are in `frontend/src/changelog.ts`.

## Run it on the homelab (Docker)

Every push to `main` builds a `linux/amd64` image and publishes it as `ghcr.io/cwland/culury:latest`.

```
mkdir culury && cd culury
# copy docker-compose.yml and .env.example from this repo
cp .env.example .env          # change POSTGRES_PASSWORD and JWT_SECRET (openssl rand -base64 48)
docker compose pull
docker compose up -d
```

Open `http://<server>:4000` and create your account.

- Everything is kept in `./data`: `./data/app` is the app's `/app/data` (backups, and later photos), `./data/postgres` is the database.
- While the repository is private, sign Docker in to GitHub's registry once: `echo <token> | docker login ghcr.io -u cwland --password-stdin` (a classic token with `read:packages`).
- Build it yourself instead: `docker buildx build --platform linux/amd64 -t culury .` (or `docker compose build`).
- Database migrations run when the container starts.

### Behind a reverse proxy

Traefik, Nginx Proxy Manager or Caddy: point the proxy at port 4000. The app reads `X-Forwarded-For` and `X-Forwarded-Proto` from proxies on private networks (Docker, your LAN). If your proxy is elsewhere, set `TRUST_PROXY` to its address. Serve it over HTTPS: passkeys, the camera (photo import) and keep-awake in Cook Mode need it.

## Develop on the Mac

```
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL (with culury and culury_test databases)
cp backend/.env.example backend/.env
npm run setup
npm run dev
```

- Web: http://localhost:5173 (Vite, hot reload)
- API: http://localhost:4000/api/health, docs at http://localhost:4000/api/docs

No Docker on the Mac? `brew install postgresql@16 && brew services start postgresql@16`, then `createdb culury && createdb culury_test` and use your Mac username in `DATABASE_URL`.

**Tests:** `npm test` runs the API tests (they use `TEST_DATABASE_URL` and wipe it each run) and the web app tests.

**Changing the database:** edit `backend/src/db/schema.ts`, then `cd backend && npm run db:generate`. The migration in `backend/drizzle/` runs the next time the API starts.

### Project layout

```
backend/            Fastify + TypeScript + Drizzle (PostgreSQL)
  src/app.ts          routes, auth check, API key scopes, security headers, rate limits, OpenAPI
  src/lib/            auth, sessions, passkeys, OAuth, AI (with failover), mail, backups, logs
  src/routes/         one file per area
  drizzle/            database migrations
  tests/              Vitest (against a real PostgreSQL)
frontend/           React + Vite + Tailwind (Figtree), light and dark themes
Dockerfile          one image: the API serves the built web app
.github/workflows/  tests + linux/amd64 image on every push
```

## API

Interactive docs at **`/api/docs`** (the OpenAPI spec at `/api/docs/json`). Every route except the health check and sign-in routes needs:

- `Authorization: Bearer <token>` (from signing in), or
- `X-API-Key: <key>` (create keys in **Settings → API keys**)

Try a key: `curl -H "X-API-Key: <key>" https://recipes.example.com/api/info`

Send a recipe in (a Recipe push key works). Ingredients and steps can be one block of text or lists:

```
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"title":"Overnight Oats","ingredients":"1/2 cup oats\n1/2 cup milk","steps":"Stir.\n\nChill overnight.","tags":["breakfast"],"collections":["Make Ahead"]}' \
  https://recipes.example.com/api/recipes
```

Import a recipe from a link (or `"text"` for pasted text). `"wait"` holds the request up to that many seconds so you get the result in one go; without it you get a job to check at `GET /api/imports/:id`:

```
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"url":"https://www.seriouseats.com/...","wait":30}' \
  https://recipes.example.com/api/recipes/import
```

For an **iOS Shortcut** that imports from the share sheet: *Receive URLs from Share Sheet* → *Get Contents of URL* (method POST, header `X-API-Key`, JSON body `url` = Shortcut Input, `wait` = 30) → *Show Result*. A Recipe push key is all it needs.

Main recipe routes: `GET /api/recipes?q=&tag=&category=&collection=&favorite=true&sort=recent|newest|title|rating`, `GET/PATCH/DELETE /api/recipes/:id`, `POST /api/recipes/:id/duplicate`, `PUT /api/recipes/:id/me` (your favorite, pin, rating, notes; signed in only), `POST /api/recipes/:id/substitutions`, and `/api/tags`, `/api/categories`, `/api/collections`.

### API key access

Each key has one access type, chosen when it's made and changeable later:

| Access | Can |
|---|---|
| Read only | Read recipes, meal plans, grocery lists and pantry |
| Write only | Add, change and delete them (no reading) |
| Recipe push | Only send recipes in (`POST /api/recipes`, `POST /api/recipes/import`) and check on imports |
| Grocery list write | Only add to, check off and change grocery lists |
| Full admin | Everything above, plus logs, backups and exports |

No key can ever see or change settings, other keys, sign-in details, or restore a backup. The rules are in `backend/src/lib/keyAccess.ts`. **Settings → API keys** has an on/off switch that refuses every key at once.

## Security

- Security headers on every response (CSP, no framing, nosniff, HSTS over HTTPS).
- Rate limits per address on sign-in, setup, password reset and passkey/OAuth sign-in (10 a minute), plus a lockout after 5 failed passwords. Guessing API keys blocks the address for a while.
- Logins are bearer tokens (not cookies), so cross-site request forgery doesn't apply; the API is same-origin only (no CORS).
- Saved secrets (AI keys, email password, OAuth client secret) are encrypted with a key derived from `JWT_SECRET`.

## Household

- The first account is the household **owner**. Add the people you live with in **Settings › Household**: give them a password, or email an invite (needs email set up) so they choose their own.
- Everyone shares recipes, the meal plan, grocery lists and the pantry. Favorites, pins, ratings, private notes, theme and sign-in are each person's own.
- Owners (there can be several) manage server settings: Email, AI, API keys, Data (backups), Logs, OAuth sign-in, and the household. Members don't see those tabs, and the API refuses them.
- Locked out? `docker compose exec culury npm run reset-password -- <username>` (without a username it resets the owner).

## Grocery list and pantry

- **Grocery** (#/grocery): type or paste items (“eggs, 2 lb chicken thighs, milk”). They're sorted by store aisle; tap one to put it in the cart, tap ⋯ to change the amount, aisle, note or list.
- **Add to grocery list** on a recipe (at the servings you chose) or **Week ▾ › Add this week to the grocery list** on the meal plan. The same ingredient from several recipes is added up into one line. Items in the pantry start unticked, and staples are never added.
- When you're done shopping, **Done: put them in the pantry** moves what's in the cart to the pantry.
- **Pantry** (#/pantry): what you have, with use-by dates and staples (salt, oil, spices). **Cook with what you have** lists recipes you can mostly make from it.
- Changes show up live on every signed-in device in the household (grocery list, pantry and meal plan).
- Home Assistant: make an API key with **Grocery list write** access and `POST /api/grocery/items` with `{"text": "milk"}` (header `x-api-key`). It goes on the first list.

## AI

Turn it on in **Settings › AI** and add one or more services (OpenAI, Claude, Gemini, OpenRouter, or a home server like Ollama). They're tried in order: if one is down, the next answers.

- **Use it for**: tick **Quick jobs** on a cheap, fast model and untick it on an expensive one, and the quick jobs (aisle sorting, nutrition, meal ideas) go to the cheap one. Tick **Can read photos** on services whose model takes pictures. Reading recipes from pages and text uses every service, in order.
- **Recipes from photos**: Add recipe › From a photo. `POST /api/recipes/import/photos` (multipart, field `photo`, up to 4) works with a Recipe push API key too.
- **Nutrition**: per serving, from the recipe's site, estimated by AI (`POST /api/recipes/:id/nutrition`), or typed in (`PUT`). The points figure is an approximation from calories, saturated fat, sugar and protein, not any diet program's official number.
- **Meal ideas**: Meal plan › Week ▾ › Meal ideas, or on the Pantry page (`POST /api/ai/ideas`).
- **Aisles**: items the word list can't place are sorted by AI once and remembered.
- **AI Enhance**: a newly added recipe offers "Check this recipe with AI?", and every recipe has an **AI check** button. The AI fills gaps in the steps, catches missing ingredients, estimates nutrition and suggests categories (from your own list) and tags. A side-by-side window shows the original and the suggestion for each part; you keep the parts you want, and **Undo AI changes** puts the recipe back (the latest AI change). Checking saves nothing. Brief steps (a few short lines) are rewritten in full: grouped under headings, each step with a short bold label and the how and why; detailed steps only get gaps filled. While it works, the window shows live progress (which service it's asking, a fallback to the next, what it found). Switch it off in Settings › AI. API: `POST /api/recipes/:id/enhance` (suggestions), `…/enhance/apply` (`{ steps?, ingredients?, nutrition?, categories?, tags? }`), `…/enhance/undo`. Send `Accept: application/x-ndjson` to `/enhance` for progress lines (`{"type":"step","text":…}` then `{"type":"result",…}` or `{"type":"error",…}`).

## Sharing and backups

- **Share** on a recipe: email it, print it or save it as a PDF (the print dialog's “Save as PDF”), or download it as schema.org JSON-LD (`GET /api/recipes/:id/jsonld`).
- **Email** on the grocery list sends what's left, by aisle. Emails need **Settings › Email** set up, and are sent by signed-in people only (not API keys).
- **Meal plan email**: Settings › Profile. Uses the server's time zone, so set `TZ` in `.env` (e.g. `TZ=America/Chicago`).
- **Backups** are `.tar.gz` files with the data (`culury.json`) and every recipe photo (`photos/`), saved daily in `./data/app/backups`; the newest `BACKUP_KEEP` are kept. **Settings › Data › Restore** takes a `.tar.gz` backup or a `.json` export. A safety backup is saved before every restore.

## Accounts and passwords

- **Account menu** (your initials, bottom left; "Account" on phones): Profile & security, Sign out, Sign out everywhere.
- **Settings → Security**: change password (signs out every other device), passkeys, OAuth sign-in, signed-in devices (sign out any one), sign-in history.
- **Email** in **Settings → Email**: pick a provider (Gmail, Outlook, iCloud, Fastmail, or custom) and **Send test email**. `SMTP_*` / `MAIL_FROM` / `APP_URL` in `.env` are a fallback.
- **Forgot password?** shows on the sign-in page when email is set up. Reset links work once, for 1 hour.
- **Locked out without email?** On the server: `docker compose exec culury npm run reset-password -- <username>` (Mac: `cd backend && npm run reset-password -- <username>`).

### Passkeys

Sign in with Touch ID, Face ID, Windows Hello or a phone. Add one in **Settings → Security → Passkeys**.
A passkey belongs to the address it was added on, and browsers only offer them on `https://` and `localhost`. Optional: `PASSKEY_ORIGINS=https://recipes.example.com` limits them to those addresses.

### OAuth sign-in (Authentik, Authelia, Keycloak, Google, GitHub…)

1. At your provider, create an OAuth2/OpenID Connect app with the redirect URI shown in **Settings → Security** (`https://<your address>/api/auth/oauth/callback`).
2. Turn OAuth on, name the button, enter the issuer / discovery URL, client ID and secret, then **Test connection**.
   Authentik: `https://auth.example.com/application/o/<app-slug>/` · Keycloak: `https://kc.example.com/realms/<realm>` · Google: `https://accounts.google.com`
3. **Link my account** (or sign in once with a verified email that matches your profile).
4. Optional: **OAuth only** hides the password form.

**Locked out?** `docker compose exec culury npm run auth:reset`, or set `EMERGENCY_DISABLE_OAUTH=true` in `.env` and restart.

## Cooking

- **Start cooking** on a recipe opens Cook Mode: one step at a time (Next / Back, swipe, or the arrow keys), with the ingredients as a checklist and the ones the step uses lit up.
- The screen is kept awake with the Wake Lock API, which browsers only allow on `https://` addresses (and localhost). Over plain `http://` on your LAN it shows "Screen may sleep".
- Times in steps become timer buttons. Timers live in your browser, keep running across pages and reloads, and ring with a chime, a buzz on phones, and a notification if you allow them.
- Servings and units (as written, metric, US) are remembered per recipe in your browser. Teaspoons and tablespoons stay as they are; cups, ounces and pounds convert (rounded the way a jug or kitchen scale reads), and oven temperatures in steps switch between °F and °C.

## Importing recipes

- **From a link:** recipe sites that include schema.org recipe data (most do) import without AI. Other pages, and TikTok, Instagram or YouTube videos (their description), are read by your AI service.
- **From a file:** Add a recipe › From a file takes a Paprika export (`.paprikarecipes`, or one `.paprikarecipe`), with photos, categories, ratings and notes. Recipes you already have (same link, or same name and ingredients) are skipped. `POST /api/recipes/import/file` (multipart, field `file`).
- **Pasted text:** read straight away when it has "Ingredients" and "Instructions" headings, otherwise by AI.
- Imports run in the background (a job queue in PostgreSQL), so they survive a restart. Results and problems show in Settings › Logs › Imports.
- Some sites turn away apps (403). Paste the recipe text instead.
- The server fetches links for you, so it refuses addresses that point at itself (localhost, link-local). Pages on your LAN import fine.
- Photos are saved in `/app/data/photos` (resized to 1600 px, WebP) and served at `/api/photos/...` without signing in (the names are random). Unused ones are cleared daily.

## AI

**Settings → AI**: add one or more services: OpenAI, Claude, Gemini, OpenRouter, or a home AI with an OpenAI-style API (Ollama, LocalAI, vLLM, LM Studio). They're tried in order; if one is down or too slow, the next is asked (and it shows in Settings → Logs). The on/off switch at the top stops all AI use and keeps your services.

## Backups and restore

- A backup is saved every day in `/app/data/backups` (the newest 30 are kept; `BACKUP_KEEP`). **Settings → Data** has Back up now, downloads, and Restore.
- Restore replaces all recipe data with the file's; your login is kept and a `-before-restore` backup is saved first.
- Backups include your settings. Saved keys and passwords are included only when `BACKUP_KEY` is set, encrypted with it. **Keep a copy of `BACKUP_KEY` away from the server** (a password manager): it can't be recovered. Restoring on another server needs the same `BACKUP_KEY`.

## New version bar

When a newer release is published on GitHub (`UPDATE_REPO`, default `cwland/Culury`), a bar at the top offers its notes. While the repository is private, set `GITHUB_TOKEN` (fine-grained, this repo only, Contents: Read-only). Turn it off in **Settings → Data → Updates**.

## Credits

Built from the platform of Zero Smart Budget (Corys Dollar). Icons: [Lucide](https://lucide.dev) (ISC).
