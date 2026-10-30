# Culury

**Your recipes, meal plans and groceries, self-hosted.** A recipe manager for the homelab: import from any site, a photo or a handwritten card, cook step by step, plan the week, and shop from one shared list. AI is optional and can run on your own hardware.

## Status

Built in steps:

| Step | What | Status |
|---|---|---|
| 1 | Foundation: sign-in (password, passkeys, OAuth), devices, API keys with scopes, AI services with failover, email, logs, backups, themes + dark mode, Docker, CI | **Done** |
| 2 | Recipes: database, CRUD, tags, collections, favorites, full-text search | Next |
| 3 | Import: schema.org JSON-LD, AI fallback, background jobs | |
| 4 | Recipe pages and Cook Mode (wake lock, steps, timers, scaling, units) | |
| 5 | Meal planner calendar | |
| 6 | Grocery lists and pantry, household sync | |
| 7 | More AI: photos and handwriting, nutrition, aisle sorting, meal ideas | |
| 8 | Sharing and export (HTML email, JSON-LD, PDF), photos in backups | |

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

**Tests:** `npm test` (uses `TEST_DATABASE_URL` and wipes it each run).

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

## Accounts and passwords

- **Account menu** (your initials, bottom left; "Account" on phones): Profile & security, Sign out, Sign out everywhere.
- **Settings → Security**: change password (signs out every other device), passkeys, OAuth sign-in, signed-in devices (sign out any one), sign-in history.
- **Email** in **Settings → Email**: pick a provider (Gmail, Outlook, iCloud, Fastmail, or custom) and **Send test email**. `SMTP_*` / `MAIL_FROM` / `APP_URL` in `.env` are a fallback.
- **Forgot password?** shows on the sign-in page when email is set up. Reset links work once, for 1 hour.
- **Locked out without email?** On the server: `docker compose exec culury npm run reset-password` (Mac: `cd backend && npm run reset-password`).

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
