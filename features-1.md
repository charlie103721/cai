# FanMouth（球迷嘴替）— Feature-1 Roadmap

TikTok-style, dark, mobile-first app for football-fan persona chat: vertical swipe
feed of AI characters, daily-topic reels, immersive chat, inbox, profile.
Built **feature by feature**: one feature = one branch = one PR, working end-to-end
before the next begins. **Build order is API-first.**

**Design references (pixel source of truth — open in a browser; they need network
for the React/Babel CDN). Kit notes in [`dp/qiumi-app/README.md`](./dp/qiumi-app/README.md):**

- **Mobile** (< `lg`): [`dp/qiumi-app/FanMouth Mobile.html`](./dp/qiumi-app/FanMouth%20Mobile.html)
  — full-bleed swipe feed, bottom tab bar, chat as full-screen overlay.
- **Desktop** (`lg`+): [`dp/qiumi-app/FanMouth Desktop.html`](./dp/qiumi-app/FanMouth%20Desktop.html)
  — TikTok-web style: 240px left sidebar (logo, nav, Recent chats), centered
  440×660 card feed with the action rail beside the card, chat as a right
  panel (max-640px centered messages), inbox/profile as centered columns,
  Edit-profile modal.
**Design rationale & extended discussion:** [`feature-1.md`](./feature-1.md)
(this roadmap is self-sufficient; read feature-1.md only when you want the *why*).

## Stack (already in place — see AGENT.md for conventions)

- Cloudflare Workers + Hono + TypeScript; Bun locally; Wrangler deploy
- React 19 SPA (React Router, TanStack Query, Tailwind v4, shadcn/radix), Workers static assets
- Cloudflare D1 (SQLite) + Drizzle ORM, migrations in `server/db/migrations`
- better-auth (email + GitHub/Google) with two-tier tokens; guest mode via `guest_id` httpOnly cookie
- LLM: OpenRouter via plain `fetch` (`server/lib/llm.ts`), model `OPENROUTER_MODEL` (default `anthropic/claude-haiku-4.5`)
- Response envelope: `ok(c, data)` → `{data, requestId}` / `fail(c, code, msg, status)` → `{error:{message,code,httpStatus}, requestId}` — never raw `c.json()`
- Request context: `c.get('db')` (Drizzle), `c.get('user')` (`{userId,email,name,role} | null`), `c.get('guestId')` (always set)

## Locked decisions

- **No login gate, ever.** Everyone starts as a guest (`guest_id` cookie). Auth is an
  upgrade offered contextually (rate limit hit, claiming @handle) — never a wall.
- **Owner pattern everywhere.** Every owner-scoped row has exactly one of
  `user_id`/`guest_id`. Every query by entity id ALSO filters by owner. New tables
  copy the pattern from `server/features/chat/repo.ts`.
- **Chat transport is WebSocket; no streaming output; no polling.** One user turn may
  produce **multiple assistant messages**; each arrives as one complete `message`
  frame (no token streaming). Push, don't poll. REST send endpoint remains as
  fallback + test seam. SSE is removed.
- **D1 is the source of truth; the socket is delivery-only.** Anything missed while
  disconnected is recovered by one REST fetch on reconnect — recovery, not polling.
- **No Redis / external state.** Socket routing + hot counters = Durable Object
  (`ConnectionHub`, one per owner). Queues = CF Queues. Cache = none.
- **Message order and read-state ride `seq`** (per-conversation monotonic integer),
  never timestamps. Timestamps are display-only.
- **`sender_character_id` on every assistant message; `conversation_characters`
  membership table** — DMs today, group chat later with zero schema change.
  Group-chat orchestration/UI is OUT of this roadmap.
- **Media-ready schema now, media features later.** `kind`/`status`/`media_url`
  columns ship in the schema feature; queue consumer / R2 / generation are OUT of
  this roadmap.
- **Seeded counters.** Character like/chat counts start from per-character seed
  values (the feed must not launch at zero); real rows add on top.
- **Feed CTA reuses the latest conversation** with that character (one thread per
  character in the inbox); a new conversation is created only if none exists.
  Topic-seeded entry always creates a new conversation.
- **Profile "Likes" stat = likes the user has given.**
- **Dark-only; two real layouts, one component set.** `class="dark"` stays.
  Mobile (< `lg`) follows the Mobile design (tab bar, full-bleed slides, chat
  overlay); desktop (`lg`+) follows the Desktop design (sidebar, card feed,
  chat panel). Screens share data hooks and inner components (rail, bubbles,
  slides, inbox rows, profile body) — only the frame/layout differs.
  `--brand` is the single accent (token values in F7).
- **Local dev**: F1–F5 keep the fast Bun loop (`bun run local`). F6 (Durable
  Object) onward requires `wrangler dev` for the server half — see F6.
  CHECK constraints and enum-ish values are app-enforced (Zod) — D1 can't add
  CHECKs without table rebuilds.

---

## Features

### ✅ = merged | 🔨 = in progress | ⬜ = not started

### ⬜ F1 — Chat domain schema + shared owner module

*No dependencies. Everything else depends on this.*

One Drizzle migration (generated via `bun run db:generate`) + `server/db/schema.ts`
changes + a shared owner-filter module. No endpoint changes: new columns are
nullable/defaulted, existing code keeps compiling.

**New tables** (snake_case):

- `character_likes`: `id` text PK, `user_id` text NULL FK→`user.id` (`restrict`),
  `guest_id` text NULL, `character_id` text NOT NULL, `created_at` timestamp.
  Indexes: **partial unique** `(user_id, character_id) WHERE user_id IS NOT NULL`,
  **partial unique** `(guest_id, character_id) WHERE guest_id IS NOT NULL`
  (SQLite treats NULLs as distinct — a plain unique index would NOT dedupe guest
  rows), plus `character_id` index. Drizzle: `uniqueIndex(...).on(...).where(sql\`...\`)`.
- `character_favorites`: identical shape/indexes.
- `conversation_characters`: `conversation_id` text NOT NULL FK→conversations
  (`cascade`), `character_id` text NOT NULL, `joined_at` timestamp,
  composite PK `(conversation_id, character_id)`.

**Column additions** (D1-legal `ALTER TABLE ADD COLUMN` — nullable or literal default):

- `conversations` + `type` text NOT NULL DEFAULT `'dm'` (`'dm'|'group'`),
  `topic_id` text NULL, `last_read_seq` integer NOT NULL DEFAULT 0
- `chat_messages` + `seq` integer NOT NULL DEFAULT 0,
  `sender_character_id` text NULL, `kind` text NOT NULL DEFAULT `'text'`,
  `status` text NOT NULL DEFAULT `'complete'`, `media_url` text NULL,
  `client_msg_id` text NULL
- `user` + `handle` text NULL (+ unique index), `favorite_team` text NULL
- `daily_topics` + `headline` text NOT NULL DEFAULT `''`, `heat` integer NOT NULL
  DEFAULT 0, `tags` text NOT NULL DEFAULT `'[]'`, `character_ids` text NOT NULL
  DEFAULT `'[]'`, `hue` integer NOT NULL DEFAULT 28, `pinned` integer(bool)
  NOT NULL DEFAULT false

**New indexes** (create AFTER the backfill): unique
`chat_messages(conversation_id, seq)`; partial unique
`chat_messages(conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL`.

**Backfill** (hand-written SQL appended to the generated migration):

```sql
UPDATE chat_messages SET seq = (
  SELECT COUNT(*) FROM chat_messages m2
  WHERE m2.conversation_id = chat_messages.conversation_id
    AND m2.rowid <= chat_messages.rowid);
INSERT INTO conversation_characters (conversation_id, character_id, joined_at)
  SELECT id, character_id, unixepoch() FROM conversations;
UPDATE chat_messages SET sender_character_id =
  (SELECT character_id FROM conversations c WHERE c.id = chat_messages.conversation_id)
  WHERE role = 'assistant';
UPDATE conversations SET last_read_seq =
  COALESCE((SELECT MAX(seq) FROM chat_messages m WHERE m.conversation_id = conversations.id), 0);
```

**Shared owner module** — `server/features/shared/owner.ts`: move the `Owner` type
and generalize the owner filter from `chat/repo.ts` into helpers usable by any
table with `user_id`/`guest_id` columns: `ownerFilter(table, owner)` and
`ownerColumns(owner)` (insert values). Update `chat/repo.ts` to import from it
(re-export `Owner` for compatibility).

**Timestamps rule**: SQL-side updates use `sql\`(unixepoch())\`` (Drizzle
`{mode:'timestamp'}` = epoch seconds); `$defaultFn(() => new Date())` stays fine
for inserts.

**Tests**: migration applies on a fresh DB; guest double-like rejected by the
partial unique index; owner module user/guest filtering; backfill correctness
(seed rows → run SQL → assert seq order + membership rows + read cursors).

### ⬜ F2 — Character engagement APIs: likes, favorites, enriched list

*Depends on F1.*

**Character data** (`server/features/characters/data.ts`): add per character
`hue`, `seed_likes`, `seed_chats` (values from the design mock):

| id | hue | seed_likes | seed_chats |
|---|---|---|---|
| argentina-uncle | 220 | 241000 | 8926 |
| rival-mouth | 8 | 123000 | 6610 |
| sharp-pundit | 285 | 98000 | 4302 |
| old-coach | 155 | 61000 | 2884 |
| fake-fan-savior | 190 | 157000 | 9021 |
| prophet | 265 | 67000 | 3550 |

**Likes** — new `server/features/characters/repo.ts`:

- `toggleLike(db, owner, characterId)` — race-safe, **no read-then-write**:
  `INSERT … onConflictDoNothing().returning()`; row returned → `{liked:true}`,
  else `DELETE` by owner+character → `{liked:false}`.
- `POST /api/characters/:id/like` (guest ok) → 404 `CHARACTER_NOT_FOUND` unknown
  id; → `ok(c, { liked, like_count })`, `like_count = seed_likes + COUNT(rows)`.
- Shared light limiter for like+favorite toggles: `createRateLimiter(120)` per owner.

**Favorites** — new feature folder `server/features/favorites/` (router + repo),
mounted at `/api/favorites` in `server/index.tsx`:

- `GET /api/favorites` (guest ok) → owner's favorited characters (public shape),
  newest first (ids → roster via `getCharacter`, skip unknown).
- `POST /api/favorites/:characterId` — idempotent insert; 404 unknown id;
  → `ok(c, { favorited: true }, 201)`.
- `DELETE /api/favorites/:characterId` — idempotent → `ok(c, { favorited: false })`.
- Repo exports `countFavorites(db, owner)`, `findFavoritedCharacterIds(db, owner)`.

**Enriched characters list** — `GET /api/characters` (and `/:id`) per character:

```json
{ "id": "...", "name": "...", "emoji": "...", "tagline": "...", "greeting": "...",
  "hue": 220, "like_count": 241003, "liked": false,
  "chat_count": 8930, "favorited": true }
```

One `db.batch()` of four queries (one round trip): likes GROUP BY character,
conversations GROUP BY character (`chat_count = seed_chats + n`), owner's liked
ids, owner's favorited ids; merge into the static roster. `persona` is NEVER
serialized. Update the `PublicCharacter` type in `client/src/lib/chat.ts`.

**Tests**: toggle on/off/on; idempotent favorite POST/DELETE; owner isolation;
counts include seeds; `liked`/`favorited` reflect the caller; unknown ids 404.

### ⬜ F3 — Chat core rewrite: multi-bubble replies, seq, JSON transport, inbox

*Depends on F1.*

The transport-agnostic heart. After this feature chat works fully over REST
(SSE deleted); F6 adds the socket on top of the same service functions.

**`server/lib/llm.ts`**: add `completeChatCompletion(params)` — same params as the
stream fn but `stream: false`; returns `choices[0].message.content` (throw on
`!res.ok` or empty). Delete `openChatCompletionStream` + `parseSseTextDeltas`.

**`server/features/chat/service.ts`** — replace `streamReply` with:

```ts
sendMessage(params: {
  db; llm; character; conversation;   // full row (id, topic_id, last_read_seq)
  content: string; clientMsgId?: string;
}): Promise<{ userMessage: ChatMessage; messages: ChatMessage[] }>
```

1. **Idempotency**: if `clientMsgId` matches an existing
   `(conversation_id, client_msg_id)` row → return that user message + the
   assistant messages that followed it (no LLM call).
2. Build context = last 30 stored messages + new content **in-memory**
   (do NOT insert first).
3. `buildSystemPrompt(db, character, seededTopic?)` — see topic seeding below.
   Extend `SHARED_GUARDRAILS` in `characters/data.ts`: the character MAY split
   its reply into 1–3 separate short chat bubbles using a line containing only
   `---` as the separator.
4. `completeChatCompletion` → split on `/\n---\n/`, trim, drop empties, cap 3;
   no delimiter → one bubble (graceful fallback).
5. **Atomic batch**: assign consecutive `seq` via the
   `INSERT … SELECT COALESCE(MAX(seq),0)+k` pattern inside ONE `db.batch()`:
   user message (`role:'user'`, `client_msg_id`), each bubble
   (`role:'assistant'`, `sender_character_id: character.id`), then
   `touchConversation` (+ title = first user message, ≤30 chars). LLM failure →
   throw; **nothing persisted** (router → 503 `CHAT_UNAVAILABLE`; client keeps
   composer text; retry = plain resend).

`createConversationWithGreeting`: greeting gets `seq=1` + `sender_character_id`;
conversation gets `last_read_seq=1` + a `conversation_characters` row; optional
`topic` param stores `topic_id`.

**Router** (`chat/router.ts`):

- `POST /api/chat/conversations/:id/messages`: remove `streamSSE`; Zod
  `{content: 1..2000, clientMsgId?: uuid}`; keep rate limits (guest 15/h,
  user 60/h) + `GUEST_LIMIT_REACHED`/`RATE_LIMITED` split + owner-scoped lookup;
  → `ok(c, { userMessage, messages })`.
- `POST /api/chat/conversations`: body `{characterId, topicId?}`. No `topicId` →
  **reuse** the owner's latest conversation with that character if one exists
  (return it + messages + `reused: true`), else create. With `topicId` → always
  create; topic must exist and be active (`findTopicById`, add to `topics/repo.ts`)
  else 404 `TOPIC_NOT_FOUND`; store `topic_id`.
- **Topic-seeded prompt**: when the conversation has `topic_id`,
  `buildSystemPrompt` appends:
  `【本次对话来源】用户是从话题「{title}」进入的：{content}——开场和前几轮优先围绕这个话题展开。`
  Daily-topic injection stays as-is.

**Inbox** — `findConversations` gains correlated scalar subqueries (Drizzle `sql`
fragments, riding the `(conversation_id, seq)` index): `last_content`,
`last_role`, `last_kind` (highest-seq message) and `unread_count` =
`COUNT(*) WHERE role='assistant' AND seq > last_read_seq`. List rows:
`{...conversation, character, last_message: {role, content, kind, created_at} | null,
unread_count}`. New `POST /api/chat/conversations/:id/read` (guest ok,
owner-scoped): `last_read_seq = (SELECT COALESCE(MAX(seq),0) …)` →
`ok(c, { last_read_seq })`.

**Client seam** (`client/src/lib/chat.ts`): delete `streamChatMessage`; add
`sendChatMessage(conversationId, content, clientMsgId)`; patch the existing
`Chat.tsx` minimally so the current UI still works (typing state until promise
resolves → append `messages[]`). Full redesign is F8.

**Tests**: bubble split (0/1/2 delimiters, cap 3); atomicity on LLM failure;
seq consecutive; clientMsgId replay returns same rows; reuse vs topic-create;
greeting seq/read-cursor/membership; unread math (greeting excluded, N bubbles →
N, read resets); cross-owner 404s; topic 404; prompt contains topic section.

### ⬜ F4 — Topic reels API

*Depends on F1. (Independent of F3 — parallelizable.)*

- Admin `POST /api/topics` Zod adds: `headline` (≤120), `heat` (int ≥0), `tags`
  (string[] ≤8, each ≤24 chars), `character_ids` (string[], every id in the
  roster → 400 `UNKNOWN_CHARACTER`), `hue` (0–360), `pinned` (bool). Router
  stringifies `tags`/`character_ids` to JSON text for insert.
- `GET /api/topics/today` (public) per topic:
  `{ id, title, headline, content, topic_date, heat, tags: string[], hue, pinned,
  participants: [{id, name, emoji}] }` — participants expanded from
  `character_ids` via the roster (in-memory; skip unknown ids). Parse JSON
  columns defensively (bad JSON → `[]`, never 500). Sort `pinned DESC,
  created_at DESC` in SQL. Update the client `DailyTopic` type.
- Tests: create roundtrip; unknown character rejected; sort order; malformed
  JSON degrades to `[]`.

### ⬜ F5 — Profile, stats, guest→account merge

*Depends on F1, F2.*

**Profile** — new `server/features/users/router.ts`, mounted at `/api/me`:

- `GET /api/me/profile` — `authGuard` → `ok(c, { name, handle, favorite_team, image })`.
- `PATCH /api/me/profile` — `authGuard`; Zod `{handle?: /^[a-z0-9_]{3,20}$/
  (lowercase before validating), favorite_team?: ≤40 chars}`; `role` never
  accepted. Handle unique violation → 409 `HANDLE_TAKEN` (catch the constraint
  error — no check-then-insert race).
- `GET /api/me/stats` — **guest ok**; one `db.batch()` of three owner-scoped
  counts → `ok(c, { chats, favorites, likes })` (conversations, favorites,
  likes-given).

**Merge** — `server/middleware/mergeGuest.ts`, mounted on `/api/*` after
`jwtAuth` + `guestId` in `server/index.tsx`: when `c.get('user')` AND a
`guest_id` cookie exist → `mergeGuest(db, guestId, userId)` (in
`users/repo.ts`), then clear the cookie (maxAge 0). One `db.batch()`:

1. delete guest likes/favorites whose `character_id` collides with existing user
   rows (subquery per table),
2. `UPDATE character_likes / character_favorites / conversations
   SET user_id = :userId, guest_id = NULL WHERE guest_id = :guestId`.

Idempotent (second run matches zero rows); covers sign-up, sign-in, and new
devices.

**Tests**: handle regex/normalization; 409 duplicate; guest stats; role can't be
smuggled; merge moves rows; collision keeps the user's row; second run no-op;
cookie cleared.

### ⬜ F6 — WebSocket: ConnectionHub Durable Object + client transport lib

*Depends on F3.*

**wrangler.jsonc**: add
`"durable_objects": {"bindings": [{"name": "CONNECTION_HUB", "class_name": "ConnectionHub"}]}`
and `"migrations": [{"tag": "v1", "new_sqlite_classes": ["ConnectionHub"]}]`.
Export the class from `server/index.tsx`. Run `bun run cf-typegen`.

**Dev workflow (required)**: DOs don't exist in plain Bun. Add script
`"local:worker": "concurrently -n client,server \"bun run serve:client\" \"wrangler dev --port $PORT\""`
(PORT from `.env`, matching the Vite proxy — never hardcode) and use it from this
feature on; keep `bun run local` for non-DO work. In `vite.config.ts`, set
`ws: true` on the `/api` proxy.

**Frame protocol** (JSON, discriminated by `type`; Zod schemas shared in
`server/features/chat/frames.ts`, types mirrored client-side). There is no
"reply" — only **0..N `message` frames**, each one complete persisted row
(multi-bubble turns, future media completions, future proactive sends are all
the same frame):

- client → server: `send_message {clientMsgId, conversationId, content}` ·
  `mark_read {conversationId}` · `ping`
- server → client: `ack {clientMsgId, userMessage}` (user message persisted) ·
  `typing {conversationId, on}` · `message {conversationId, message}` (full row
  incl. `sender_character_id`, `kind`, `status`) ·
  `unread_update {conversationId, unread_count}` (reserved; emitted by `/notify`) ·
  `error {clientMsgId?, code}` (same codes as REST) · `pong`

**`server/do/connectionHub.ts`** — class `ConnectionHub`:

- `fetch()`: `/connect` → WebSocket upgrade via `this.ctx.acceptWebSocket(ws)`
  (**Hibernation API**, never `ws.accept()`; owner key + kind stored via
  `serializeAttachment`); `/notify` → POST from other Workers, pushes frames to
  connected sockets (no-op when none) — the seam the future media consumer uses.
- `webSocketMessage(ws, raw)`: Zod-parse, dispatch:
  - `send_message` → rate limit (sliding-window counters in `ctx.storage`;
    guest 15/h, user 60/h) → owner-scoped conversation load → F3's `sendMessage`
    service (ALL rows land in one batch first) → `ack` → then pace delivery:
    `typing on` → per bubble `message` frame with 400–900ms gaps → `typing off`.
    The DO paces *frames*, never writes. Errors → `error` frame; F3 semantics
    (nothing persisted on LLM failure).
  - `mark_read` → same update as F3's read endpoint.
  - `ping` → `pong`.
- D1 access: build the drizzle instance from `env.DB` per event (like
  `dbMiddleware` does).

**Upgrade route** (`server/index.tsx`): `GET /api/ws` — after jwtAuth + guestId
resolve the owner; non-upgrade requests → 426;
`env.CONNECTION_HUB.idFromName(ownerKey).fetch('…/connect', req)` with
`ownerKey = 'user:<id>' | 'guest:<id>'` passed via internal header.

**Client transport lib** (`client/src/lib/ws.ts`, no UI changes yet): connect on
app mount (`wss` same-origin `/api/ws`); TS frame types; auto-reconnect with
exponential backoff (1s→30s cap); `onReconnect` invalidates TanStack Query
caches (conversation list + open conversation) — the reconcile fetch;
`sendMessage()` falls back to the F3 REST endpoint when the socket isn't OPEN;
simple event-emitter API (`on('message' | 'ack' | 'typing' | …)`).

**Tests**: frame Zod schemas (unit); ConnectionHub protocol (ack→typing→message
order, idempotent resend, rate-limit error frame) via
`@cloudflare/vitest-pool-workers` (new dev dep, separate vitest project);
service behavior already covered through the F3 REST seam.

### ⬜ F7 — Client: design tokens, shell, For You feed, topic reels

*Depends on F2, F4.*

**Design files for this feature (open in a browser, copy markup/styles/SVGs
from their source — sections named below):**

- Mobile (< `lg`): **`dp/qiumi-app/FanMouth Mobile.html`** — components
  `TabBar`, `TopTabs`, `Scene`, `PersonaSlide`, `Rail`, `Progress`, `TopicSlide`,
  and the `@keyframes` block (`float`/`pop`/`rise`/`blink`/`glow`).
- Desktop (`lg`+): **`dp/qiumi-app/FanMouth Desktop.html`** — components
  `Sidebar` (+ `NAV_ICONS`), `Card`, `PersonaSlide`, `Rail`, `TopicSlide`.

**Design tokens first** — cai's `client/src/index.css` currently has **no brand
tokens and no `--font-sans`**. Add (values are canon, from the design project;
"brand" is the amber-gold flame accent):

```css
:root {
  --brand: oklch(0.78 0.16 78);
  --brand-foreground: oklch(0.24 0.05 75);
  --brand-wash: oklch(0.95 0.05 85);
  --brand-wash-border: oklch(0.85 0.10 82);
  --brand-glow: 42 90% 52%;   /* hsl parts, for shadows: hsl(var(--brand-glow) / .4) */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", "Noto Sans SC", sans-serif;
}
.dark {
  --brand: oklch(0.83 0.15 82);
  --brand-foreground: oklch(0.22 0.05 75);
  --brand-wash: oklch(0.32 0.07 78);
  --brand-wash-border: oklch(0.50 0.11 80);
  --brand-glow: 45 92% 55%;
}
```

Expose to Tailwind v4 via `@theme` (`--color-brand: var(--brand)` etc.) so
`bg-brand`/`text-brand-foreground` utilities work. Also add the design's
keyframes (`float`, `pop`, `rise`, `blink`, `glow` — copy from the design file)
and a shared `fmt` count formatter (`≥10000 → x.xw`, `≥1000 → x.xk`) in
`client/src/lib/format.ts`.

**Responsive shell** (`client/src/components/AppShell.tsx`, rebuilt) — one shell,
two frames, switching at Tailwind `lg`:

- **Mobile (< `lg`, per the Mobile design)**: 100dvh column; 30px status-bar
  spacer; content region; `TabBar` (Home/Topics/Chats/Me — exact SVG paths from
  the design's `TabBar`; active = brand stroke icon + white label; badge slot on
  Chats wired in F8).
- **Desktop (`lg`+, per the Desktop design's `Sidebar`)**: 240px left sidebar on
  `#0a0a0b` with right hairline border — `⚽ FanMouth` logo, nav items
  (For You/Topics/Chats/Me; active = `rgba(255,255,255,.08)` pill + brand stroke
  icon + 700 weight), `RECENT` section listing recent conversations
  (emoji + name, from the conversations query) that open chats directly.
  Content area fills the rest.

Routes (`App.tsx`): `/` feed, `/topics`, `/chats` (placeholder until F8), `/me`
(placeholder until F8), keep `/login` + `/signup`; `/chat/:conversationId` is a
full-screen overlay on mobile and replaces the content area (sidebar stays) on
desktop. Remove `/landing`, `/about`, `/dashboard`, `/users` from routing (keep
files). `TopTabs` (`For You · Topics`) floats over the feed screens on mobile
only (desktop navigates via the sidebar). No focus rings; no
`window.confirm/alert/prompt`.

**For You feed** (`FeedPage` at `/`): `scroll-snap-type: y mandatory`, one slide
per character from `GET /api/characters`.

- Mobile (per the Mobile design's `PersonaSlide`/`Rail`/`Scene`/`Progress`):
  full-bleed slide — hue radial-gradient scene + glow blob + floating 140px
  emoji; bottom gradient overlay with `@name` + verified-check SVG, greeting,
  brand pill CTA `Start chatting →`; rail overlaid bottom-right; right-edge
  progress dots track scroll index.
- Desktop (per the Desktop design's `Card`): each slide centers a 440×660
  rounded-20 card (same scene/overlay inside, 168px emoji, 20px name) with the
  action rail standing beside the card's bottom-right; no progress dots.

`ActionRail` (shared; TikTok-style solid icons, drop-shadow, no chrome — exact
SVGs from the designs; desktop sizes slightly larger per the Desktop file):
avatar + follow ＋ badge (`POST/DELETE /api/favorites/:id`, optimistic, ＋→✓
when favorited); solid heart (brand fill when `liked`, optimistic
`POST /api/characters/:id/like`, pop animation, `fmt` count); filled chat
bubble (`chat_count`, tap = CTA); filled share arrow (`navigator.share`,
clipboard + sonner fallback). CTA/💬 → `POST /api/chat/conversations
{characterId}` → navigate `/chat/:id` (server reuses).

**Topic reels** (`TopicsPage` at `/topics`): same snap pattern over
`GET /api/topics/today`; 🔥 float emoji; `Today's Topic · Heat {fmt(heat)}` in
brand; small title; big headline (26px/800 mobile, 30px desktop); #tag chips;
bottom overlay "Pick a character and dive into this topic" + participant avatar
circles + brand `Chat →` → `POST /api/chat/conversations
{characterId: participants[0].id, topicId}` → `/chat/:id`. Full-bleed slide on
mobile, centered card on desktop (rail-width spacer keeps it aligned with the
feed). Empty state: one quiet slide pointing to the For You feed.

**Tests** (client vitest project): `fmt` formatter; like optimistic rollback on
error; shell tabs + route switching; reels empty state; topic chat-seeding call
shape.

### ⬜ F8 — Client: chat overlay, inbox, profile — live over the socket

*Depends on F5, F6, F7.*

**Design files for this feature (open in a browser, copy markup/styles/SVGs
from their source — sections named below):**

- Mobile (< `lg`): **`dp/qiumi-app/FanMouth Mobile.html`** — components `Chat`
  (header, bubbles, `Typing`, composer), `Inbox`, `Profile` (hero banner,
  stats, favorites scroller, `menu` settings list).
- Desktop (`lg`+): **`dp/qiumi-app/FanMouth Desktop.html`** — components `Chat`
  (right-panel variant, max-640px centered column), `Inbox` (centered column),
  `Profile` (incl. the **Edit-profile modal** — canonical for both layouts).

**Chat** (rebuild `client/src/pages/Chat.tsx` per both designs' `Chat`):
full-screen overlay on mobile; on desktop it fills the content area beside the
persistent sidebar, with messages and composer in a centered max-640px column.
Hue gradient scene; header = back / avatar circle / name + verified /
`● Online` (static) / ★ (favorites API, optimistic); glass bubbles (assistant
white-glass left + emoji avatar, user brand right, 18px radius with 5px tail
corner, rise-in animation); typing-dots component; pill composer (Enter sends,
Shift+Enter newline, send disabled + 0.45 opacity when empty).
Data: `GET /api/chat/conversations/:id` on mount. Send via the F6 WS manager —
optimistic user bubble keyed by `clientMsgId`, confirmed by `ack` (on `error`:
remove bubble, restore composer, sonner toast); typing dots driven by `typing`
frames; each `message` frame appends a bubble (1..N per turn, no special-casing);
REST fallback when socket is down (all bubbles at once). `mark_read` over the
socket on mount + when frames land in the open chat (REST fallback).
`GUEST_LIMIT_REACHED` → inline signup-prompt bubble; `RATE_LIMITED` → toast with
retry-after. Non-text `kind`s render a placeholder card.

**Inbox** (per both designs' `Inbox`): `ChatsPage` at `/chats` — rows from the
enriched conversations list: hue-gradient avatar, name, relative time from
`updated_at` (`now/2m/18m/1h/3h/1d` formatter), one-line ellipsized
`last_message.content` (prefix `[图片]`/`[视频]` for media kinds), brand
unread-count badge when `unread_count > 0` (99+ cap). Full-width list on
mobile; centered max-640px column on desktop. Tap → `/chat/:id`.
Long-press/kebab → custom confirm dialog → `DELETE /api/chat/conversations/:id`.
Chats tab/sidebar badge = sum of `unread_count` from the query cache, updated
in place by `message`/`unread_update` frames (no refetch). The desktop
sidebar's `RECENT` list reuses this query (top 6 by `updated_at`).

**Profile** (per both designs' `Profile` — hero-banner revision): `MePage` at
`/me` — gradient hero banner (118px mobile / 150px desktop) + ⚙ button; avatar
circle overlapping (-46px / -52px, dark border + brand ring); `@handle`
(authed) or localStorage display name + "Sign up to claim your @handle" CTA
(guests; `useLocalStorage` from usehooks-ts); bio line
`World Cup die-hard · Team {favorite_team}`; stat row (value-over-label,
hairline borders) from `GET /api/me/stats`; full-width brand `Edit profile` →
**modal dialog exactly per the Desktop design** (dark card, `@`-prefixed
username input, bio textarea, Cancel / brand Save; authed:
`PATCH /api/me/profile`, 409 `HANDLE_TAKEN` shown inline; guest: localStorage
name/team + signup CTA). Body content centers at max-560px on desktop. ★ FAVORITES:
horizontal scroller of brand-ringed hue-gradient avatars + truncated names from
`GET /api/favorites` (dashed empty state per the design); tap → open chat (same
call as feed CTA). SETTINGS card list (icon/label/value/chevron per the design):
Notifications "On" (static) · Appearance "Dark" (static) · Language "English"
(static) · Help & feedback (mailto) · Log out (authed; better-auth signout).
Static rows quiet/disabled — no dead-end alerts.

**Tests**: multi-bubble append via frames; optimistic rollback; guest-limit UI
branch; relative-time formatter; badge sum; delete uses custom dialog; profile
guest vs authed branches; handle-taken inline error.

---

## Post-roadmap (explicitly OUT of feature-1)

- Media generation pipeline (CF Queue consumer, R2, pending→ready `message`
  frames — schema + frame protocol + `/notify` seam are already in place;
  Queues requires Workers Paid)
- Web Push notifications (pairs with P1 赛后召回)
- Group chat orchestration + UI (schema ready: `type`, `conversation_characters`,
  `sender_character_id`)
- Follow tab as a filtered feed; conversation share cards; real presence
