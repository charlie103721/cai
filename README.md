<img src="client/public/vite.svg" alt="Vite logo" width="80" />

# Fullstack CF Base

Full-stack template built with **Hono** + **React** running on **Cloudflare Workers**.

**Stack:** Hono (REST API), React 19, React Query, Better Auth, Drizzle ORM + Cloudflare D1 (SQLite), Tailwind CSS v4, Vite

---

## Setup

### 1. Create your project

```sh
gh repo create <name> --private
git init && git remote add origin <repo-url>
git remote add template https://github.com/charlie103721/fullstack-cf-base.git
git fetch template && git checkout -b main template/main
git remote remove template && git push -u origin main
bun install
```

### 2. Rename

Update `"name"` in both files:
- `package.json` — change `"name": "my-hono-app"` to your project name
- `wrangler.jsonc` — change `"name": "my-hono-app"` to your project name (this becomes your `*.workers.dev` subdomain)

### 3. D1 Database

Create a D1 database on Cloudflare:

```sh
bunx wrangler d1 create <name>-db --location=wnam
```

> Available locations: `wnam` (US West), `enam` (US East), `weur` (Western Europe), `eeur` (Eastern Europe), `apac` (Asia Pacific)

This outputs a database ID. Update `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "<name>-db",
    "database_id": "<your-d1-database-id>",
    "migrations_dir": "server/db/migrations"
  }
]
```

Also update the `db:migrate:prod` script in `package.json` to match your database name:

```json
"db:migrate:prod": "wrangler d1 migrations apply <name>-db --remote"
```

> **LLM users:** If you're using an AI assistant to set up the project, have it run `wrangler d1 create` and update both `wrangler.jsonc` and `package.json` with the database name and ID.

### 4. Secrets

```sh
cp .env.prod.example .env.prod
```

Open `.env.prod` and fill in every value:

| Variable | How to get it |
|---|---|
| `BETTER_AUTH_SECRET` | Generate a random secret: `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Your production URL, e.g. `https://my-app.my-subdomain.workers.dev` or your custom domain |
| `CLIENT_URL` | Same as `BETTER_AUTH_URL` (they share the same origin in this template) |
| `GITHUB_CLIENT_ID` | GitHub OAuth app → Settings → Developer settings → OAuth Apps → Client ID |
| `GITHUB_CLIENT_SECRET` | Same page → "Generate a new client secret" |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Same page → Client secret |

> **OAuth is optional.** Leave `GITHUB_*` and `GOOGLE_*` empty if you only need email/password auth.

> **Tip:** If you're using an LLM-powered editor (Claude Code, Cursor, etc.), you can ask it to generate the `.env.prod` file for you — it can run `openssl rand -hex 32` and fill in the URLs based on your `wrangler.jsonc` name. Just provide any OAuth credentials.

```sh
bun run secrets:push
```

### 5. Local dev

No external database needed — local dev uses a SQLite file (`local.db`) via `bun:sqlite`.

```sh
cp .env.example .env
```

Generate an auth secret and set it in `.env`:

```sh
openssl rand -hex 32
```

Run migrations and start dev:

```sh
bun run db:migrate
bun run local
```

This starts Vite (client) and Hono (server) together via `concurrently`. The client is at `http://localhost:5173` and the server at `http://localhost:8443` (configurable via `PORT` in `.env`). Vite proxies `/api/*` to the server.

### 6. Deploy

Build client, run prod migrations, deploy to Cloudflare Workers:

```sh
bun run deploy
```

Your app is live at `https://<name>.<your-subdomain>.workers.dev`

### 7. Auto-deploy (GitHub Actions)

The workflow at `.github/workflows/deploy.yml` is already included. It handles:
- **Push to main** → build, migrate production DB, deploy to Cloudflare Workers
- **Pull requests** → build and deploy a preview worker per branch
- **Daily cron** → clean up stale preview workers from closed PRs
- **Manual trigger** → `workflow_dispatch` for on-demand deploys

Set GitHub secrets:

```sh
bun run secrets:github
```

This pushes `BETTER_AUTH_SECRET` from `.env.prod`. If the repo is in an **org**, Cloudflare secrets are skipped (they're provided by org-level secrets). For **personal repos**, it also auto-detects and pushes `CLOUDFLARE_ACCOUNT_ID`, and you'll need to set the API token manually:

```sh
gh secret set CLOUDFLARE_DEPLOY_API_TOKEN     # CF API token (see permissions below)
```

**CF API Token permissions** — create at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Custom token:

| Permission | Access |
|---|---|
| Account → Cloudflare Workers Scripts → **Edit** | Deploy workers |
| Account → D1 → **Edit** | Run migrations |
| Account → Account Settings → **Read** | Resolve account |
| Account → R2 Storage → **Edit** | If using R2 buckets |
| Zone → Workers Routes → **Edit** | If using custom domains |

---

## Auth

Auth uses **httpOnly cookies** (not localStorage) for JWT storage. This prevents XSS attacks from stealing tokens — JavaScript cannot read httpOnly cookies.

**How it works:**
- On login/signup, the server sets an httpOnly cookie with the JWT
- The browser sends the cookie automatically on every request (`credentials: 'include'`)
- `GET /api/auth/me` returns the current user (since JS can't read the cookie directly)
- `POST /api/auth/logout` clears the cookie server-side
- `jwtAuth` middleware reads the cookie first, falls back to `Authorization: Bearer` header for API clients/mobile apps

**Key files:**
- `server/lib/auth.ts` — Better Auth setup, JWT signing, cookie helpers (`setAuthCookie`, `clearAuthCookie`, `getAuthCookie`)
- `server/middleware/authHandler.ts` — `/me`, `/token`, `/logout` endpoints + Better Auth proxy
- `server/middleware/jwtAuth.ts` — Non-blocking middleware (cookie → header fallback)
- `server/middleware/securityHeaders.ts` — CSP, HSTS, X-Frame-Options, etc.
- `client/src/contexts/AuthContext.tsx` — AuthProvider with React Query deduplication
- `client/src/hooks/useAuth.ts` — thin `useContext` wrapper

---

## Database

This template uses **Drizzle ORM** with **Cloudflare D1** (SQLite). In production, D1 runs at the edge — no external database or connection pooling needed.

### How it works

- **Schema** is defined in `server/db/schema.ts` using Drizzle's `sqliteTable` helpers.
- **Migrations** are generated SQL files in `server/db/migrations/`, produced by `drizzle-kit generate`.
- **Connection** is managed by `server/db/index.ts` — in dev it uses a local SQLite file via `bun:sqlite`, in production it uses the D1 binding.
- **Config** lives in `drizzle.config.ts` at the project root.

### Adding a new table

1. Define the table in `server/db/schema.ts`:

```ts
export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

2. Generate a migration:

```sh
bun run db:generate
```

This creates a new `.sql` file in `server/db/migrations/`.

3. Apply it:

```sh
bun run db:migrate
```

### Modifying an existing table

Edit the table definition in `schema.ts`, then run `db:generate` and `db:migrate` as above. Drizzle diffs your schema and generates the appropriate `ALTER TABLE` statements.

### Deploying database changes

The `deploy` script runs migrations automatically:

```sh
bun run deploy   # builds, migrates, deploys
```

To migrate production manually without deploying:

```sh
bun run db:migrate:prod
```

### Browsing the database

```sh
bun run db:studio
```

Opens Drizzle Studio at https://local.drizzle.studio — a visual browser for your local database.

### Dev vs Production connections

| | Dev | Production |
|---|---|---|
| **Database** | Local SQLite file (`local.db`) via `bun:sqlite` | Cloudflare D1 (edge SQLite) |
| **Connection** | Singleton Drizzle instance (reused across requests) | Per-request via D1 binding |
| **Config** | `drizzle.config.ts` → `local.db` | `wrangler.jsonc` → D1 binding |

---

## Scripts Reference

| Script | Description |
|---|---|
| `bun run local` | Start client + server in dev mode (server uses restart-on-save watcher) |
| `bun run serve:client` | Client only (Vite dev server) |
| `bun run serve:server` | Server only, restart-on-save (`server/**/*.ts`) |
| `bun run build` | Build client assets for production (server is bundled by Wrangler from `server/index.tsx`) |
| `bun run preview` | Build and run locally with `wrangler dev` |
| `bun run deploy` | Build client, run migrations, and deploy to Cloudflare Workers |
| `bun run test` | Run tests (Vitest, watch mode) |
| `bun run test:run` | Run tests once |
| `bun run lint` | Lint with ESLint |
| `bun run db:generate` | Generate a new migration from schema changes |
| `bun run db:migrate` | Apply pending migrations (local SQLite) |
| `bun run db:migrate:prod` | Apply pending migrations (remote D1) |
| `bun run db:push` | Push schema directly to the database (skips migration files) |
| `bun run db:studio` | Open Drizzle Studio (visual database browser) |
| `bun run secrets:push` | Push `.env.prod` secrets to Cloudflare |
| `bun run secrets:github` | Push required secrets to GitHub Actions (from `.env.prod` + auto-detected CF account) |
| `bun run cf-typegen` | Regenerate `CloudflareBindings` types from `wrangler.jsonc` |

---

## Project Structure

```
├── client/              # React SPA (Vite + React Router)
│   └── src/
│       ├── components/  # UI components (shadcn/ui)
│       ├── contexts/    # React contexts (AuthContext)
│       ├── hooks/       # React hooks (useAuth, useDocumentTitle)
│       ├── lib/         # API client (fetch + React Query), auth utilities
│       └── pages/       # Route pages
├── server/              # Hono backend (REST API)
│   ├── config.ts        # Runtime config (isDev flag, etc.)
│   ├── db/
│   │   ├── schema.ts    # Drizzle table definitions (sqliteTable)
│   │   ├── index.ts     # DB connection middleware (bun:sqlite dev / D1 prod)
│   │   └── migrations/  # SQL migration files (generated by drizzle-kit)
│   ├── features/        # Feature modules (router/service/repo/schema)
│   ├── lib/             # Auth setup (better-auth + JWT cookie helpers)
│   ├── middleware/       # Auth, JWT, security headers, logging, error handling
│   └── util/            # Shared helpers (logger, response formatting)
├── scripts/             # Deployment utilities
├── wrangler.jsonc       # Cloudflare Workers config
├── vite.config.ts       # Client build config
```

---

## Local Dev

`bun run local` uses `concurrently` to run two processes:

| Service | URL | Script |
|---|---|---|
| Client (Vite) | `http://localhost:5173` | `vite --host` |
| Server (Hono) | `http://localhost:8443` | `bun --watch run server/dev.ts` |

The server port is read from `PORT` in `.env` (default `8443`). Vite reads the same `.env` via `loadEnv` and proxies `/api/*` to `http://localhost:${PORT}`:

```
Browser → http://localhost:5173/api/health
       → Vite proxy → http://localhost:8443/api/health
       → Hono server
```

This mirrors production where both client and API share the same origin on Cloudflare Workers.

---

## Scheduled Tasks (Cron)

A cron trigger is configured in `wrangler.jsonc` to run every hour (`0 * * * *`). The handler is the `scheduled` export in `server/index.tsx`. Edit it to add your own scheduled jobs.

Test cron locally:

```sh
curl "http://localhost:8443/__scheduled?cron=0+*+*+*+*"
```
