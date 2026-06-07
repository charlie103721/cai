# Agent Instructions

## UI
- No focus rings on inputs — use `focus-visible:ring-0` (border color change only)
- Never use `window.confirm`, `window.alert`, or `window.prompt` — use custom dialog components
- Dark mode is default (`class="dark"` on html element)

## Code Style
- Use snake_case for all DB table and column names
- Use bun, never npm (`bun add`, `bun install`, `bunx`)
- Features follow `server/features/{name}/` with router + service + repo layers
- Use Zod for all request validation
- Response format: always use `ok(c, data)` and `fail(c, code, msg)` from `server/util/response.ts` — never use raw `c.json()` or `new Response()` for JSON responses
- Use `import`, never `require()`
- Use `useLocalStorage` from `usehooks-ts` for all localStorage access — never use raw `localStorage.getItem`/`setItem`

## Database
- Drizzle ORM with PostgreSQL
- All timestamps must be UTC — never use `new Date()` in Drizzle `.set()` or `.$onUpdate()` calls. The pg driver serializes JS Date with the server's local timezone, causing incorrect values. Always use `sql\`now()\`` to let PostgreSQL generate timestamps in UTC.
- Use `restrict` delete on user FKs — users should never be hard-deleted
- All repo queries that accept an entity ID must also filter by parent scope (e.g. project_id) to prevent cross-project access

## Infrastructure
- Local dev: `bun run local` (concurrently runs Vite client + Hono server)
- Vite config reads `PORT` from `.env` via `loadEnv` — never hardcode the proxy target
- Deploy: `bun run deploy` (builds client + migrates prod DB + deploys to CF Workers)
- Secrets: `bun run secrets:push` reads `.env.prod` and pushes to Cloudflare

## Auth
- better-auth for email/password + OAuth (GitHub, Google)
- **Two-tier tokens**: better-auth session (14d, server-side, acts as refresh token) + custom JWT (1h, httpOnly cookie, acts as access token)
- JWT via `c.get("user")` returns `{ userId, email, name, role }`
- `authGuard` middleware enforces 401 on missing user
- `requireRole("admin", ...)` middleware gates routes by role; zero DB hit (reads from JWT claim)
- Never skip auth checks on protected routes

## Roles
- Vocabulary: `server/features/users/roles.ts` (`USER_ROLES` const + `UserRole` type)
- Storage: `user.role` text column (not a PG enum — extend by editing the TS const)
- Security: registered with better-auth as `additionalFields.role` with `input: false` — blocks sign-up / update-user API from setting role. Only direct DB writes or dedicated admin endpoints can change it.
- Server route gating: `app.get("/admin", jwtAuth, requireRole("admin"), handler)`
- Server non-HTTP contexts (workers, scripts): `getUserRole(db, userId)` from `server/features/users/repo.ts` for fresh reads
- Client UI gating: `const isAdmin = useHasRole("admin")` from `@/hooks/useAuth`
- Role staleness: bounded by access token lifetime (`ACCESS_TOKEN_EXPIRES_IN_SECONDS` in `server/lib/auth.ts`, default 1 hour). Role changes propagate on the user's next refresh.

## Refresh flow
- `POST /api/auth/refresh` validates the better-auth session cookie, re-reads role from DB, mints a new JWT cookie
- Client `fetchApi` auto-handles 401: single-flight refresh → retry original request → on refresh failure, dispatches `AUTH_STATE_CHANGE_EVENT` (→ AuthContext re-queries `/me` → null → UI shows logged-out state)
- Emergency revocation: destroy the BA session row in DB; user's next refresh 401s within ≤1 hour
