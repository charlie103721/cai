# FanMouth（球迷嘴替）— Feature-1 Roadmap

TikTok-style, dark, mobile-first app for football-fan persona chat: vertical swipe
feed of AI characters, daily-topic reels, immersive chat, inbox, profile.
Built **feature by feature**: one feature = one branch = one PR, working end-to-end
before the next begins. **Build order is API-first.**

**Design reference (pixel source of truth):**
[`dp/qiumi-app/FanMouth Mobile.html`](./dp/qiumi-app/FanMouth%20Mobile.html) —
open in a browser (needs network for the React/Babel CDN). Kit notes in
[`dp/qiumi-app/README.md`](./dp/qiumi-app/README.md).
**Design rationale & extended discussion:** [`feature-1.md`](./feature-1.md)
(this roadmap is self-sufficient; read feature-1.md only when you want the *why*).

## Stack (already in place — see AGENT.md for conventions)

- Cloudflare Workers + Hono + TypeScript; Bun locally; Wrangler deploy
- React 19 SPA (React Router, TanStack Query, Tailwind v4, shadcn/radix), Workers static assets
- Cloudflare D1 (SQLite) + Drizzle ORM, migrations in `server/db/migrations`
- better-auth (email + GitHub/Google) with two-tier tokens; guest mode via `guest_id` httpOnly cookie
- LLM: OpenRouter via plain `fetch` (`server/lib/llm.ts`), model `OPENROUTER_MODEL` (default `anthropic/claude-haiku-4.5`)
- Response envelope: `ok(c, data)` → `{data, requestId}` / `fail(c, code, msg, status)` → `{error:{message,code,httpStatus}, requestId}` — never raw `c.json()`

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
- **Profile "Likes" stat = likes the user has given.**
- **Dark-only, mobile-first.** `class="dark"` stays; desktop gets a centered
  phone-width column. Flame-orange `--brand` is the single accent.
- **Local dev**: features F1–F10 keep the fast Bun loop (`bun run local`).
  F11 (Durable Object) onward requires `wrangler dev` for the server half —
  see F11's spec for the dev-script change. CHECKs and enum-ish values are
  app-enforced (Zod) — D1 can't add CHECK constraints without table rebuilds.

---

## Features

### ✅ = merged | 🔨 = in progress | ⬜ = not started

### ⬜ F1 — Chat domain schema + shared owner module

*No dependencies. Everything else depends on this.*

One Drizzle migration (generated via `bun run db:generate`) + schema.ts changes +
a shared owner-filter module. No endpoint changes yet (existing code keeps working:
new columns are nullable/defaulted; `chat/repo.ts` continues to compile untouched
except where noted).

**New tables** (all in `server/db/schema.ts`, snake_case):

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

**New indexes**: unique `chat_messages(conversation_id, seq)` — but only AFTER the
backfill below; partial unique `chat_messages(conversation_id, client_msg_id)
WHERE client_msg_id IS NOT NULL`.

**Backfill** (hand-written SQL appended to the generated migration file):

```sql
-- seq: number existing messages per conversation in rowid order
UPDATE chat_messages SET seq = (
  SELECT COUNT(*) FROM chat_messages m2
  WHERE m2.conversation_id = chat_messages.conversation_id
    AND m2.rowid <= chat_messages.rowid);
-- membership: every existing conversation is a DM with its character
INSERT INTO conversation_characters (conversation_id, character_id, joined_at)
  SELECT id, character_id, unixepoch() FROM conversations;
-- sender: existing assistant messages were sent by the DM character
UPDATE chat_messages SET sender_character_id =
  (SELECT character_id FROM conversations c WHERE c.id = chat_messages.conversation_id)
  WHERE role = 'assistant';
-- read cursor: nothing is suddenly unread on deploy
UPDATE conversations SET last_read_seq =
  COALESCE((SELECT MAX(seq) FROM chat_messages m WHERE m.conversation_id = conversations.id), 0);
```

**Shared owner module** — `server/features/shared/owner.ts`: move the `Owner` type
and generalize the owner filter from `chat/repo.ts` into a factory usable by any
table with `user_id`/`guest_id` columns (e.g.
`ownerFilter(table, owner)` and `ownerColumns(owner)` returning
`{user_id, guest_id}` insert values). Update `chat/repo.ts` to import from it
(re-export `Owner` for compatibility).

**Timestamps rule**: SQL-side updates use `sql\`(unixepoch())\`` (Drizzle
`{mode:'timestamp'}` = epoch seconds); `$defaultFn(() => new Date())` stays fine
for inserts.

**Tests**: migration applies on a fresh local DB; double-insert of the same
guest like is rejected by the partial unique index; owner module filters
user vs guest correctly; backfill logic (seed rows, run backfill SQL, assert seq
sequence and membership rows).

### ⬜ F2 — Character likes API

*Depends on F1.*

- New `server/features/characters/repo.ts`: `toggleLike(db, owner, characterId)` —
  race-safe, **no read-then-write**: `INSERT … onConflictDoNothing().returning()`;
  inserted row → `{liked:true}`, else `DELETE` by owner+character → `{liked:false}`.
  Also `countLikesByCharacter(db)` (GROUP BY) and `findLikedCharacterIds(db, owner)`.
- Route in `characters/router.ts`: `POST /api/characters/:id/like` (guest ok) →
  404 `CHARACTER_NOT_FOUND` for unknown id; else `ok(c, { liked, like_count })`
  where `like_count = seed_likes + COUNT(rows)`.
- Add per-character `seed_likes` + `seed_chats` to `characters/data.ts`
  (from the design mock): argentina-uncle 241000/8926 · rival-mouth 123000/6610 ·
  sharp-pundit 98000/4302 · old-coach 61000/2884 · fake-fan-savior 157000/9021 ·
  prophet 67000/3550. Also add `hue`: argentina-uncle 220 · rival-mouth 8 ·
  sharp-pundit 285 · old-coach 155 · fake-fan-savior 190 · prophet 265.
- Rate limit: shared `createRateLimiter(120)` for like+favorite toggles per owner.
- Tests: toggle on/off/on; two owners don't interfere; unknown character 404;
  guest and user scoping.

### ⬜ F3 — Character favorites API

*Depends on F1.*

New feature folder `server/features/favorites/` (router + repo), mounted at
`/api/favorites` in `server/index.tsx`. Backs the rail follow ＋, chat ★, and
profile favorites.

- `GET /api/favorites` (guest ok) → `ok(c, PublicCharacter[])` — owner's favorited
  characters, newest first (join ids → roster via `getCharacter`, skip unknown ids).
- `POST /api/favorites/:characterId` — idempotent insert (`onConflictDoNothing`);
  404 `CHARACTER_NOT_FOUND` unknown id; → `ok(c, { favorited: true }, 201)`.
- `DELETE /api/favorites/:characterId` — idempotent delete → `ok(c, { favorited: false })`.
- Repo also exports `countFavorites(db, owner)` and
  `findFavoritedCharacterIds(db, owner)` for F4/F9.
- Tests: idempotency (double POST = one row), owner isolation, list order.

### ⬜ F4 — Characters list with counters

*Depends on F2, F3.*

`GET /api/characters` (and `/:id`) response per character becomes:

```json
{ "id": "...", "name": "...", "emoji": "...", "tagline": "...", "greeting": "...",
  "hue": 220, "like_count": 241003, "liked": false,
  "chat_count": 8930, "favorited": true }
```

- One `db.batch()` of four queries (D1 batch = one round trip):
  likes GROUP BY character, conversations GROUP BY character
  (`chat_count = seed_chats + n`), owner's liked ids, owner's favorited ids.
  Merge into the static roster in the repo. `persona` is NEVER serialized.
- Update client type `PublicCharacter` in `client/src/lib/chat.ts`.
- Tests: counts include seeds; `liked`/`favorited` reflect the calling owner;
  batch shape (no N+1 loops in code).

### ⬜ F5 — Topic reels API

*Depends on F1.*

- Admin `POST /api/topics` Zod schema adds: `headline` (≤120), `heat` (int ≥0),
  `tags` (string[] ≤8 items, each ≤24 chars), `character_ids` (string[], every id
  must exist in the roster → 400 `UNKNOWN_CHARACTER`), `hue` (0–360), `pinned`
  (bool). Router stringifies `tags`/`character_ids` to JSON text for insert.
- `GET /api/topics/today` (public) returns per topic:
  `{ id, title, headline, content, topic_date, heat, tags: string[], hue, pinned,
  participants: [{id, name, emoji}] }` — `participants` expanded from
  `character_ids` via the roster (in-memory; skip unknown ids). Parse JSON columns
  defensively (bad JSON → `[]`, never a 500). Sort: `pinned DESC, created_at DESC` in SQL.
- `findTopicById(db, id)` in `topics/repo.ts` (active only) — needed by F7.
- Update client `DailyTopic` type.
- Tests: create-with-fields roundtrip, unknown character id rejected, sort order,
  malformed JSON column degrades to `[]`.

### ⬜ F6 — Chat core rewrite: multi-bubble replies, seq, JSON transport (SSE removed)

*Depends on F1.*

The transport-agnostic heart. After this feature the chat works fully over REST;
F11 adds the socket on top of the same service functions.

**`server/lib/llm.ts`**: add `completeChatCompletion(params)` — same shape as the
stream fn but `stream: false`, returns `choices[0].message.content` (throw on
`!res.ok` / empty). Delete `openChatCompletionStream` + `parseSseTextDeltas`.

**`server/features/chat/service.ts`** — rewrite `streamReply` as:

```ts
sendMessage(params: {
  db; llm; character; conversation;           // full row (has id, topic_id, last_read_seq)
  content: string; clientMsgId?: string;
}): Promise<{ userMessage: ChatMessage; messages: ChatMessage[] }>
```

1. Idempotency: if `clientMsgId` set and a row with `(conversation_id, client_msg_id)`
   exists → return the existing user message + the assistant messages after it
   (same seq turn) without calling the LLM.
2. Build context = last 30 stored messages + the new user content **in-memory**
   (do NOT insert first).
3. `buildSystemPrompt(db, character, seededTopic?)` (see F7 for the topic arg;
   pass undefined here) + extend `SHARED_GUARDRAILS` in `characters/data.ts`:
   the character MAY split its reply into 1–3 separate short chat bubbles using
   a line containing only `---` as the separator.
4. Call `completeChatCompletion`. Split on `/\n---\n/`, trim, drop empties, cap 3;
   no delimiter → one bubble (graceful fallback).
5. **Atomic batch**: assign consecutive `seq` via
   `INSERT … SELECT COALESCE(MAX(seq),0)+k` pattern inside ONE `db.batch()`:
   user message (`role:'user'`, `client_msg_id`), then each bubble
   (`role:'assistant'`, `sender_character_id: character.id`), then
   `touchConversation` (+ title from first user message, ≤30 chars).
   LLM failure → throw; **nothing persisted** (caller returns 503
   `CHAT_UNAVAILABLE`; client keeps composer text; retry = plain resend).
6. `createConversationWithGreeting` gains: greeting inserted with `seq=1`,
   `sender_character_id`, conversation `last_read_seq=1`, membership row in
   `conversation_characters`, optional `topic` param (F7).

**`chat/router.ts`**: `POST /api/chat/conversations/:id/messages` — remove
`streamSSE` entirely; body Zod `{content: 1..2000, clientMsgId?: uuid}`; keep the
existing rate limiting + owner-scoped conversation lookup + `GUEST_LIMIT_REACHED`
vs `RATE_LIMITED` split; → `ok(c, { userMessage, messages })`.

**`POST /api/chat/conversations`** body becomes `{characterId, topicId?}`
(`topicId` handled in F7 — accept & ignore-with-404 until then is NOT ok; simply
don't add it to the schema until F7). Response unchanged plus
`reused: boolean` — per the locked decision, if the owner already has a
conversation with that character (and no `topicId`), return the latest one with
its messages instead of creating.

**Client `client/src/lib/chat.ts`**: delete `streamChatMessage`; add
`sendChatMessage(conversationId, content, clientMsgId)` via `fetchApi`. Update
`client/src/pages/Chat.tsx` minimally to keep the existing UI working
(send → typing state until promise resolves → append returned messages).
The full redesigned UI is F14.

**Tests**: bubble splitting (0/1/2 delimiters, cap at 3), atomicity on LLM
failure (no rows), seq consecutiveness, clientMsgId replay returns same rows,
conversation reuse, greeting seq/read-cursor/membership, rate-limit codes.

### ⬜ F7 — Topic-seeded chat

*Depends on F5, F6.*

- `POST /api/chat/conversations` Zod adds `topicId?: string`. If present:
  `findTopicById` (active) else 404 `TOPIC_NOT_FOUND`; always CREATE a new
  conversation (reuse rule does not apply to topic entries), store `topic_id`,
  primary character = `characterId` (must be in the topic's `character_ids`,
  else 400 `CHARACTER_NOT_IN_TOPIC`).
- `buildSystemPrompt(db, character, seededTopic?)`: when the conversation has a
  `topic_id`, the router/service loads the topic and the prompt appends:
  `【本次对话来源】用户是从话题「{title}」进入的：{content}——开场和前几轮优先围绕这个话题展开。`
  Daily-topic injection stays as-is.
- Tests: seeded create stores topic_id, prompt contains the section (assert via a
  seam that exposes the built prompt), inactive topic 404, wrong character 400.

### ⬜ F8 — Inbox API: last message, unread count, mark-read

*Depends on F6.*

- `findConversations` gains correlated scalar subqueries (Drizzle `sql` fragments),
  all riding the `(conversation_id, seq)` index:
  `last_content`, `last_role`, `last_kind` (highest-seq message) and
  `unread_count` = `COUNT(*) WHERE role='assistant' AND seq > last_read_seq`.
  Response rows: `{...conversation, character, last_message: {role, content, kind,
  created_at} | null, unread_count}`.
- `POST /api/chat/conversations/:id/read` (guest ok, owner-scoped) — sets
  `last_read_seq = (SELECT COALESCE(MAX(seq),0) FROM chat_messages WHERE
  conversation_id = ?)` → `ok(c, { last_read_seq })`; 404 if not owner's.
- Tests: greeting not unread; N bubbles → unread_count N; read resets to 0;
  cross-owner 404.

### ⬜ F9 — Profile API: handle, favorite team, stats

*Depends on F1. (Uses F3's `countFavorites` if merged; else inline count — prefer building after F3.)*

New `server/features/users/router.ts`, mounted at `/api/me`:

- `GET /api/me/profile` — `authGuard`; → `ok(c, { name, handle, favorite_team, image })`.
- `PATCH /api/me/profile` — `authGuard`; Zod `{handle?: /^[a-z0-9_]{3,20}$/ (lowercased
  before validate), favorite_team?: ≤40 chars}`; `role` is never accepted. Unique
  violation on handle → 409 `HANDLE_TAKEN` (catch the constraint error — no
  check-then-insert race). → updated profile.
- `GET /api/me/stats` — **guest ok**; one `db.batch()` of three owner-scoped counts →
  `ok(c, { chats, favorites, likes })` (conversations, favorites, likes-given).
- Tests: handle regex/normalization, 409 on duplicate, guest stats work, role
  cannot be smuggled.

### ⬜ F10 — Guest→account merge

*Depends on F2, F3.*

- `server/middleware/mergeGuest.ts`, mounted on `/api/*` after `jwtAuth` + `guestId`
  in `server/index.tsx`: when `c.get('user')` AND a `guest_id` cookie exist →
  run merge, then clear the cookie (maxAge 0).
- `mergeGuest(db, guestId, userId)` in `server/features/users/repo.ts`, one
  `db.batch()`:
  1. delete guest likes/favorites whose `character_id` collides with existing
     user rows (subquery per table),
  2. `UPDATE character_likes / character_favorites / conversations
     SET user_id = :userId, guest_id = NULL WHERE guest_id = :guestId`.
  Idempotent (second run matches zero rows). Covers sign-up, sign-in, and
  returning users on a new device.
- Tests: merge moves rows; collision keeps the user's row and drops the guest's;
  second run is a no-op; cookie cleared.

### ⬜ F11 — WebSocket: ConnectionHub Durable Object

*Depends on F6, F8.*

**wrangler.jsonc**: add
`"durable_objects": {"bindings": [{"name": "CONNECTION_HUB", "class_name": "ConnectionHub"}]}`
and `"migrations": [{"tag": "v1", "new_sqlite_classes": ["ConnectionHub"]}]`.
Export the class from `server/index.tsx`. Run `bun run cf-typegen`.

**Dev workflow change (required)**: DOs don't exist in plain Bun. Add script
`"local:worker": "concurrently -n client,server \"bun run serve:client\" \"wrangler dev\""`
and use it for this feature onward; keep `bun run local` for non-DO work. Vite
proxy (`vite.config.ts`): ensure `/api` proxy has `ws: true`.

**`server/do/connectionHub.ts`** — class `ConnectionHub`:

- `fetch()` handles two internal routes: `/connect` (WebSocket upgrade →
  `this.ctx.acceptWebSocket(ws)` — **Hibernation API**, never `ws.accept()`) and
  `/notify` (POST from other Workers → push frames to all sockets; used by future
  media consumer; no-op when no sockets).
- `webSocketMessage(ws, raw)`: parse frame (Zod), dispatch:
  - `send_message {clientMsgId, conversationId, content}` → rate limit
    (sliding-window counters in `ctx.storage`, guest 15/h, user 60/h — owner kind
    is passed in the connect URL and kept in socket attachment via
    `serializeAttachment`) → owner-scoped conversation load →
    `ack {clientMsgId, userMessage}` after the service persists → per bubble:
    `typing {conversationId, on:true}`, delay 400–900ms, `message {conversationId,
    message}` → `typing {on:false}`. Reuses **F6's `sendMessage` service** —
    the DO adds pacing only (service inserts all rows in one batch first; the DO
    paces the frames, not the writes).
  - `mark_read {conversationId}` → same update as F8's endpoint.
  - `ping` → `pong`.
  - Errors → `error {clientMsgId?, code}` frames (same codes as REST); the user
    message is NOT persisted on LLM failure (F6 semantics).
- D1 access: the DO receives `env` with the `DB` binding; build the drizzle
  instance per event like `dbMiddleware` does.

**Upgrade route** in `server/index.tsx`: `GET /api/ws` — requires the middleware
chain (jwtAuth + guestId) to resolve the owner; reject non-upgrade requests 426;
`env.CONNECTION_HUB.idFromName(ownerKey).fetch('/connect', request)` where
`ownerKey = user:<id> | guest:<id>` (owner kind + key passed via internal header).

**Client** `client/src/lib/ws.ts`: WS manager — connect on app mount
(`wss` same-origin `/api/ws`), JSON frame types mirrored in TS, auto-reconnect with
exponential backoff (1s→2s→…→30s cap), `onReconnect` hook that invalidates
TanStack Query caches (conversation list + open conversation) — the reconcile
fetch. `sendMessage` falls back to F6's REST endpoint when the socket isn't OPEN.
Wire into the existing chat page: optimistic user bubble by `clientMsgId`,
confirmed by `ack`; bubbles append on `message`; typing indicator driven by
`typing` frames.

**Tests**: frame Zod schemas (unit); ConnectionHub protocol (ack→typing→message
order, idempotent resend, rate-limit error frame) via
`@cloudflare/vitest-pool-workers` in a separate vitest project (add dev dep);
service-level behavior already covered by F6 tests through the REST seam.

### ⬜ F12 — Client: mobile shell, tab bar, routes

*No server dependencies. Can build in parallel with F2+.*

Per the design file (device frame = the app viewport; ignore the outer demo frame):

- `client/src/components/MobileShell.tsx`: 100dvh column; content region;
  `TabBar` (Home/Topics/Chats/Me — exact SVG paths from the design's `TabBar`);
  active tab = brand stroke icon + white label. On `md:`+ screens center a
  390px-wide column on `#050506`, rounded border (`.device` styles from the design).
- Routes (`client/src/App.tsx`): `/` feed (placeholder), `/topics` (placeholder),
  `/chats` (placeholder), `/me` (placeholder), keep `/login`, `/signup`; chat
  renders at `/chat/:conversationId` as a full-screen overlay route ABOVE the
  shell (shell state preserved). Remove `/landing`, `/about`, `/dashboard`,
  `/users` routes and the old `AppShell` usage from these paths (keep files;
  strip nav). Update the default route from `Characters` to the feed.
- `TopTabs` component (`For You · Topics`) floating over feed screens only.
- Status-bar spacer (30px, time text optional), dark-only.
- Tab badge slot on Chats (wired in F16). No focus rings (`focus-visible:ring-0`);
  no `window.confirm/alert/prompt` anywhere.
- Tests (client vitest project): shell renders 4 tabs, route switching, active
  states.

### ⬜ F13 — Client: For You feed + action rail

*Depends on F4, F12.*

Faithful to `PersonaSlide`/`Rail`/`Scene`/`Progress` in the design file:

- `FeedPage` at `/`: `scroll-snap-type: y mandatory` container, one full-screen
  slide per character from `GET /api/characters` (TanStack Query); right-edge
  progress dots tracking scroll index; `TopTabs` overlay.
- `PersonaSlide`: hue radial-gradient scene, glow blob, floating emoji (140px,
  float animation), bottom gradient overlay: `@name` + verified check SVG,
  greeting, brand pill CTA `Start chatting →`.
- `ActionRail` (TikTok-style solid icons, drop-shadow, no button chrome — use the
  exact SVG paths from the design's `Rail`): avatar + follow ＋ badge (→
  `POST/DELETE /api/favorites/:id`, optimistic, ＋ flips to ✓ when favorited);
  solid heart (fills brand when `liked`; optimistic toggle →
  `POST /api/characters/:id/like`; pop animation; count formatted
  `≥10000 → x.xw`, `≥1000 → x.xk`); filled chat bubble (count = `chat_count`,
  tap = CTA); filled share arrow (`navigator.share`, clipboard+sonner fallback).
- CTA/💬 → `POST /api/chat/conversations {characterId}` → navigate to
  `/chat/:id` (server handles reuse).
- Tests: like optimistic rollback on error, count formatter, snap container renders
  all characters.

### ⬜ F14 — Client: chat overlay

*Depends on F6, F7, F8, F12. (Works fully over REST; F16 upgrades it live.)*

Rebuild `client/src/pages/Chat.tsx` to the design's `Chat` component:

- Full-screen overlay: hue gradient scene from the character; header = back
  arrow / avatar circle / name + verified / `● Online` (static) / ★ toggle
  (favorites API, optimistic); message list with glass bubbles (assistant:
  white-glass left + emoji avatar; user: brand right; 18px radius with reduced
  corner on the tail side; rise-in animation); typing dots component; pill
  composer (textarea, Enter sends / Shift+Enter newline, send button disabled+
  0.45 opacity when empty).
- Data: `GET /api/chat/conversations/:id` on mount; send via F6 REST
  (`sendChatMessage`) — optimistic user bubble, typing dots until resolve,
  append `messages[]` (multi-bubble aware), on error remove bubble + restore
  composer + sonner toast. Mark-read (`POST …/read`) on mount and after each
  reply. `GUEST_LIMIT_REACHED` → inline signup-prompt bubble; `RATE_LIMITED` →
  toast with retry-after.
- Renders any `kind` defensively: non-text kinds show a placeholder card
  (media arrives post-roadmap).
- Tests: multi-bubble append, error rollback, guest-limit UI branch.

### ⬜ F15 — Client: topic reels

*Depends on F5, F7, F12.*

Per the design's `TopicSlide`:

- `TopicsPage` at `/topics`: same snap-feed pattern over `GET /api/topics/today`;
  🔥 float emoji, `Today's Topic · Heat {fmt(heat)}` in brand, small title, big
  headline (26px/800), #tag chips, bottom overlay: "Pick a character and dive
  into this topic", participant avatar circles (from `participants`), brand
  `Chat →` button → `POST /api/chat/conversations {characterId: participants[0].id,
  topicId}` → `/chat/:id`.
- Empty state: single quiet slide ("No topics today — check the For You feed").
- Tests: renders topics, empty state, chat-seeding call shape.

### ⬜ F16 — Client: inbox + live updates

*Depends on F8, F12, F14; F11 for live frames (build after F11).*

Per the design's `Inbox`:

- `ChatsPage` at `/chats`: rows from enriched `GET /api/chat/conversations` —
  hue-gradient avatar circle, name, relative time from `updated_at`
  (`now/2m/18m/1h/3h/1d` formatter), one-line ellipsized `last_message.content`
  (prefix `[图片]`/`[视频]` for media kinds), brand unread-count badge when
  `unread_count > 0` (99+ cap). Tap → `/chat/:id`.
- Long-press/kebab → custom confirm dialog → `DELETE /api/chat/conversations/:id`.
- Chats tab badge in `TabBar` = sum of `unread_count` (from the same query cache).
- Live: subscribe to the F11 WS manager — `message`/`unread_update` frames update
  the conversation-list cache in place (no refetch); `mark_read` sent over the
  socket when opening a chat (REST fallback).
- Tests: relative-time formatter, badge sum, delete flow uses custom dialog.

### ⬜ F17 — Client: profile screen

*Depends on F3, F9, F10, F12.*

Per the design's `Profile` (the `FanMouth Mobile.html` revision — hero banner
layout):

- `MePage` at `/me`: gradient hero banner (118px) with ⚙ button; avatar circle
  overlapping (-46px, dark border + brand ring); `@handle` or — for guests —
  display name from `useLocalStorage` + "Sign up to claim your @handle" CTA
  (links `/signup`); bio line `World Cup die-hard · Team {favorite_team}`;
  stat row (value-over-label, hairline top/bottom borders) from
  `GET /api/me/stats`; full-width brand `Edit profile` button → dialog
  (authed: `PATCH /api/me/profile` with 409 `HANDLE_TAKEN` inline error;
  guest: localStorage name/team + signup CTA).
- ★ FAVORITES: horizontal scroller of brand-ringed hue-gradient avatar circles +
  truncated names from `GET /api/favorites` (dashed-border empty state text from
  the design); tap → start/open chat (same call as feed CTA).
- SETTINGS card list (icon / label / value / chevron rows per the design):
  Notifications ("On", static) · Appearance ("Dark", static) · Language
  ("English", static) · Help & feedback (mailto link) · Log out (authed only,
  better-auth signout). Static rows render quiet/disabled — no dead-end alerts.
- Tests: guest vs authed branches, stats render, handle-taken error surfaced.

---

## Post-roadmap (explicitly OUT of feature-1)

- Media generation pipeline (CF Queue consumer, R2, `media_pending/ready` frames —
  schema and frame protocol are already in place; requires Workers Paid for Queues)
- Web Push notifications (pairs with P1 赛后召回)
- Group chat orchestration + UI (schema is ready: `type`, `conversation_characters`,
  `sender_character_id`)
- Follow tab as a filtered feed; conversation share cards; real presence
