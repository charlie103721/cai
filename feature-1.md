# Feature 1 — FanMouth（球迷嘴替）TikTok-style App

> Implements the design **`FanMouth Mobile.html`** from the Claude Design project
> `ebfc85b0-bb48-4eed-92e0-edca6dabbdf3` (supersedes the earlier
> `ui_kits/qiumi-app/index.html` revision): a dark, full-bleed, mobile-first vertical
> swipe feed of AI fan personas, topic reels, immersive chat, a chats inbox, and a
> profile screen.
>
> **Design file (vendored copy): [`dp/qiumi-app/FanMouth Mobile.html`](./dp/qiumi-app/FanMouth%20Mobile.html)**
> — open it in a browser for the interactive reference (needs network for the
> React/Babel CDN). Kit notes: [`dp/qiumi-app/README.md`](./dp/qiumi-app/README.md).
>
> Scope: **full stack** — client UI rebuild + server/DB changes that back it.
> Everything must work for **guests and registered users** (design removed login as a
> gate; auth stays available but is never required to use the app).

---

## 0. Design reference

| Design element | Notes |
| --- | --- |
| For You feed（推荐） | Full-screen vertical scroll-snap feed, one persona per slide: radial-gradient scene keyed by per-character `hue`, giant floating emoji, right-side action rail — TikTok-style **solid white filled icons** with drop shadow, no button chrome (avatar + follow ＋ / ♥ like fills brand when active / 💬 comment→chat / ↗ share), bold counts under each. Bottom overlay with @name ✓, greeting hook, "Start chatting →" CTA. Right-edge progress dots. |
| Topics reels（话题） | Full-screen reels per daily topic: 🔥 emoji, `Today's Topic · Heat 6.7w`, short title, big headline question, #tags, participating-persona avatars, "Chat →" seeds a chat with the linked character. |
| Immersive chat | Full-bleed overlay above the tab bar: back / avatar / name ✓ / ● Online / ★ favorite header; glass bubbles (assistant = white glass left, user = brand flame right); typing indicator; pill composer + send. |
| Chats inbox（消息） | Conversation list rows: gradient avatar, name, relative time, last-message preview (single line, ellipsis), unread count badge (design shows a dot; product wants the count). Total unread badges the Chats tab icon. |
| Profile（我的） | Gradient **hero banner** with ⚙ button; avatar overlapping the banner with a brand ring; @handle; bio line with supported team (`World Cup die-hard · Team 🇦🇷`); stat row (Chats / Favorites / Likes) framed by hairline borders; **full-width brand "Edit profile" button**; ★ FAVORITES as a **horizontal avatar scroller** (brand-ringed circles + names, dashed empty state); **SETTINGS menu list** — Notifications (On) / Appearance (Dark) / Language (English) / Help & feedback, each with icon, value, chevron. |
| Chrome | Status bar, top tabs `For You · Topics`, bottom tab bar `Home / Topics / Chats / Me`. Dark only, flame-orange `--brand` as the single accent. |

---

## 1. Current state (already built — do not redo)

- **Chat engine**: `POST /api/chat/conversations` (creates with greeting),
  `GET /api/chat/conversations`, `GET/DELETE /api/chat/conversations/:id`,
  `POST /api/chat/conversations/:id/messages` → currently SSE streaming via
  OpenRouter — **this feature replaces the SSE transport with plain JSON
  (§2.9); no streaming output anywhere.**
  Owner-scoped via `Owner = { userId } | { guestId }` (guest cookie middleware).
- **Characters**: 6 personas in `server/features/characters/data.ts`
  (`id, name, emoji, tagline, greeting, persona`), public shape strips `persona`.
- **Topics**: `daily_topics` table (`topic_date, title, content, is_active`),
  `GET /api/topics/today` public, admin create/deactivate. Injected into every
  chat system prompt (`buildSystemPrompt`).
- **Auth**: better-auth + JWT, roles, guest mode, rate limits (guest 15/h, user 60/h).
- **Client**: desktop-ish pages (`Characters.tsx`, `Chat.tsx`, `AppShell`), SSE client
  in `client/src/lib/chat.ts`, `fetchApi` in `client/src/lib/api.ts`.

---

## 2. Server work

### 2.1 Characters — extend public shape (no migration)

`server/features/characters/data.ts`:

- Add `hue: number` per character — drives the slide/chat scene gradient.
  Map from the design: argentina-uncle `220`, rival-mouth `8`, sharp-pundit `285`,
  old-coach `155`, fake-fan-savior `190`, prophet `265`.
- Add `seed_likes: number` and `seed_chats: number` per character — display bases so
  the feed doesn't launch at zero (design shows 241k etc.). Real counts are added on
  top. *(Open question #1: confirm we want seeded bases at all.)*
- `toPublicCharacter` additionally returns `hue`.

`GET /api/characters` response per character becomes:

```
{ id, name, emoji, tagline, greeting, hue,
  like_count,        // seed_likes + count(character_likes)
  liked,             // current owner has liked
  chat_count,        // seed_chats + count(conversations for this character, all owners)
  favorited }        // current owner has favorited
```

Aggregates come from `character_likes` / `character_favorites` / `conversations`
group-by queries in a new `server/features/characters/repo.ts` (characters stay
code-defined; only counters live in the DB).

### 2.2 Likes — new feature (migration)

New table `character_likes`:

```
id            text PK
user_id       text NULL FK → user.id (restrict)
guest_id      text NULL
character_id  text NOT NULL
created_at    timestamp
-- exactly one of user_id/guest_id set (same Owner pattern as conversations)
-- unique index (user_id, character_id), unique index (guest_id, character_id)
-- index on character_id for count queries
```

Routes (in `characterRoutes`):

- `POST /api/characters/:id/like` — toggle. Returns `{ liked, like_count }`.
  404 on unknown character. Guest-allowed.

### 2.3 Favorites（关注/★）— new feature (migration)

Backs the rail's follow ＋, the chat-header ★, and the Profile FAVORITES list.

New table `character_favorites` — identical shape/constraints to `character_likes`.

New feature folder `server/features/favorites/` (router + repo):

- `GET /api/favorites` — current owner's favorited characters (public shape), newest first.
- `POST /api/favorites/:characterId` — add (idempotent). 404 unknown character.
- `DELETE /api/favorites/:characterId` — remove (idempotent).

### 2.4 Topics — enrich schema for the reels (migration)

`daily_topics` gains:

```
headline      text NOT NULL DEFAULT '' -- the big question ("Who lifts the trophy?")
heat          integer NOT NULL DEFAULT 0 -- popularity number; client formats (6.7w)
tags          text NOT NULL DEFAULT '[]' -- JSON string[] ("Argentina","VAR")
character_ids text NOT NULL DEFAULT '[]' -- JSON string[]; first entry = primary
                                         -- character the "Chat →" button opens
hue           integer NOT NULL DEFAULT 28 -- reel scene color
pinned        integer(bool) NOT NULL DEFAULT false -- pinned reel sorts first
```

- `GET /api/topics/today` returns the new fields (tags/character_ids parsed to arrays,
  each character id also expanded to `{ id, name, emoji }` for the avatar row).
  Sort: pinned first, then `created_at` desc. Topics with no `character_ids` are still
  valid (reel renders without avatar row; Chat → hidden).
- Admin `POST /api/topics` Zod schema accepts the new fields (all optional with the
  defaults above); validates `character_ids` against the character roster.
- `content` keeps its existing role: operator-written context injected into the
  system prompt. `headline`/`tags`/`heat` are display-only.

### 2.5 Topic-seeded chat (migration: 1 column)

Design: tapping "Chat →" on a reel opens a chat with that topic as the frame.

- `conversations` gains nullable `topic_id text` (no FK cascade needed; topics are
  soft-deactivated, never deleted).
- `POST /api/chat/conversations` body becomes
  `{ characterId, topicId? }`. If `topicId` is present and resolves to an active topic:
  store it, and `buildSystemPrompt` for that conversation prepends a section:
  the user arrived via this topic — open and steer the first exchanges around it.
  Greeting stays the character's static greeting (no extra LLM call at create time).
- Unknown/inactive `topicId` → `TOPIC_NOT_FOUND` 404 (don't silently drop it).

### 2.6 Chats inbox — enrich list + read state (migration)

Read state is a **sequence cursor, not a timestamp**: messages carry a
per-conversation monotonic `seq` (§8.1 — required anyway because multi-bubble
batches collide at second granularity), and `conversations.last_read_seq`
points at the last seen one. No clock comparisons anywhere.

- `conversations` gains `last_read_seq integer NOT NULL DEFAULT 0`.
- `GET /api/chat/conversations` rows additionally return:
  - `last_message: { role, content, kind, created_at } | null` (subquery:
    highest-`seq` message),
  - `unread_count: number` — count of **assistant** messages with
    `seq > last_read_seq`. `insertConversation` sets `last_read_seq` to the
    greeting's seq, so the scripted greeting never counts as unread.
  - Client derives the **total unread** (for the Chats tab badge) by summing
    `unread_count` across rows — kept live between fetches by `unread_update`
    WS frames; no extra endpoint needed.
- Mark-read = `UPDATE conversations SET last_read_seq = (SELECT COALESCE(MAX(seq),0)
  FROM chat_messages WHERE conversation_id = ?)` — owner-scoped; primary path is
  the `mark_read` WS frame, REST `POST /:id/read` is the fallback. Client fires
  it on opening a chat and when `message` frames land in the open chat.

### 2.7 Profile — user fields + stats (migration)

`user` table gains:

```
handle         text NULL, unique index (case-insensitive) -- "@footy_fan"
favorite_team  text NULL                                  -- free text/emoji for P0 ("🇦🇷 Argentina")
```

New routes in `server/features/users/` (router to be created; repo exists):

- `GET /api/me/profile` — auth required → `{ name, handle, favorite_team, image }`.
- `PATCH /api/me/profile` — auth required; Zod: `handle` (3–20 chars,
  `^[a-z0-9_]+$`, uniqueness → `HANDLE_TAKEN` 409), `favorite_team` (≤40 chars).
  Never accepts `role` (better-auth `input:false` stays authoritative).
- `GET /api/me/stats` — **guest-allowed** (owner-scoped):
  `{ chats, favorites, likes }` = counts of the owner's conversations, favorites,
  and likes given. *(Open question #2: design's "Likes 3.4w" could mean likes
  received; users create nothing, so "likes given" is the P0 semantic.)*

Guests on the Me tab: show stats from `GET /api/me/stats` + a "sign up to claim your
@handle" CTA. Guest-side display name/team live in `useLocalStorage` only.

### 2.8 Identity & login strategy (guest-first)

The design has **no login screen** (removed per product owner) and this feature keeps
it that way: **login is never a gate, only an upgrade.**

- **Everyone starts as a guest.** The existing `guest_id` httpOnly cookie (1-year
  expiry, set by `middleware/guestId.ts`) is the identity. Chats, likes, favorites,
  read-state, and stats all hang off it via the `Owner` pattern — full app,
  zero friction.
- **Auth stays available, never required.** better-auth (email/password + GitHub +
  Google OAuth) is already built. The dedicated `/login`/`/signup` pages stop being
  entry points; sign-up surfaces contextually as a sheet/dialog at moments where an
  account has obvious value:
  1. guest hits the message rate limit (`GUEST_LIMIT_REACHED` 429 — already a
     distinct error code for exactly this) → "Sign up to keep chatting",
  2. Me tab → "Claim your @handle" (handle/team edits are account-only, §2.7),
  3. optionally after N chats: "Don't lose your conversations — they live on this
     device only."
- **Guest → account merge (new, required).** On sign-up/sign-in with a `guest_id`
  cookie present, re-parent the guest's data to the user:
  `UPDATE conversations/character_likes/character_favorites
   SET user_id = :userId, guest_id = NULL WHERE guest_id = :guestId`
  — likes/favorites need conflict handling on the unique `(user_id, character_id)`
  index (delete the guest row if the account already has one). Implemented as a
  better-auth after-hook (or called from the session-created path in
  `server/lib/auth.ts`), then the guest cookie is cleared. The schema comment
  already promises this ("on sign-up their conversations can be merged over") but
  **no merge code exists today** — this feature adds it.
- **Trade-off accepted for P0**: guest identity is per-device/per-browser; clearing
  cookies loses it. That's the standard TikTok/character-app pattern — the merge +
  contextual prompts are the recovery path, not a login wall.

### 2.9 Chat transport: WebSocket (product decision; no streaming output)

> **Why WebSocket**: (1) **no polling anywhere** — completions (including
> minutes-long media jobs) must be pushed, and (2) **one user turn may produce
> multiple assistant messages** — the character can reply in several bubbles,
> and later send delayed/proactive ones. Request/response transports (plain
> JSON *or* SSE-per-request) structurally deliver one response per request;
> only a persistent channel models "messages arrive when they arrive."
> This costs Durable Objects + reconnect handling on Workers — accepted.
> Two invariants keep it safe: **D1 is the source of truth** (the socket is
> delivery-only; a reconnect reconciles with one REST fetch — recovery, not
> polling) and **no token streaming** (every message is one complete frame).

**Connection model — one Durable Object per owner** (`ConnectionHub`,
`idFromName('user:<id>' | 'guest:<id>')`):

- Client opens `wss…/api/ws` at app start. The upgrade request passes through
  the existing JWT/guest middleware, then the Worker forwards to the owner's DO,
  which `acceptWebSocket()`s it using the **WebSocket Hibernation API** (idle
  sockets don't bill wall-clock; frames rehydrate the DO).
- Per-owner DO gives multiplexing for free: all conversations share the socket,
  and inbox-level events (unread bumps, media-ready in another chat) reach the
  client regardless of which screen is open.

**Frame protocol** (JSON, discriminated by `type`). The key shape decision:
there is no "reply" — there are only **`message` frames**, 0..N of them, each a
complete persisted `chat_messages` row. Multi-bubble turns, delayed sends,
media completions, and future proactive messages are all the same frame.

- client → server: `send_message {clientMsgId, conversationId, content}`,
  `mark_read {conversationId}`, `ping`
- server → client:
  - `ack {clientMsgId, userMessage}` — user message validated + persisted
  - `typing {conversationId, on}` — drives the typing indicator between bubbles
  - `message {conversationId, message}` — one assistant message (text or
    media `kind`/`status`; a `media_ready` completion is just this frame)
  - `unread_update {conversationId, unread_count}` — for conversations the
    client doesn't have open
  - `error {clientMsgId?, code}` — same codes as REST (`RATE_LIMITED`,
    `GUEST_LIMIT_REACHED`, `CHAT_UNAVAILABLE`…), `pong`
- `clientMsgId` (client-generated UUID) pairs optimistic bubbles with `ack`
  and makes resends idempotent — durably via the partial unique index on
  `chat_messages(conversation_id, client_msg_id)` (§8.1); the DO's in-memory
  record is just the fast path.
- `message.message` is the full persisted row — including
  `sender_character_id`, so the client renders the right avatar per bubble in
  DMs today and group chats later with no protocol change.

**`send_message` handling in the DO**: rate-limit (counters in DO storage —
this *fixes* the per-isolate limiter caveat of §5.1 for chat, since the owner's
traffic all lands in one DO) → persist the user message, send `ack` → `typing on`
→ load context from D1, `completeChatCompletion` (OpenRouter, `stream:false`) →
split the reply into bubbles → per bubble: insert row, push `message` frame,
short pacing delay (~400–900ms with `typing` frames between) → `typing off`.
On LLM failure: `error` frame; the user message **stays persisted** (it was
ack'd — in a multi-message world the user's send and the character's replies
are independent events, not an atomic pair; the character simply "didn't
answer" and the next send retries naturally).

**Multi-bubble generation**: the system prompt (guardrails in
`characters/data.ts`) already demands short 1–3 sentence replies; extend it to
allow splitting into **1–3 separate bubbles** using a `---` line as the
delimiter. The service splits on the delimiter, trims empties, caps at 3, and
falls back to one bubble when no delimiter appears — model-format drift
degrades gracefully.

**Reconnect & fallback**:

- Client WS manager: exponential-backoff reconnect; on reconnect, refetch the
  open conversation + conversation list via REST (source of truth), which also
  reconciles anything pushed while offline. Sends attempted while disconnected
  fail fast to the composer — no client-side outbox in P0.
- All REST **read** endpoints stay as-is. `POST …/:id/messages` **stays as a
  thin REST wrapper over the same service function**, returning
  `{ userMessage, messages: [...] }` in one response (all bubbles, no pacing) —
  degraded-client fallback and the natural seam for service-level tests
  without a socket.
- `server/lib/llm.ts`: add `completeChatCompletion` (`stream:false`,
  `choices[0].message.content`); delete `openChatCompletionStream` + SSE parser.
  Client `lib/chat.ts`: SSE consumer replaced by the WS manager + a
  `sendChatMessage` REST fallback.
- `wrangler.jsonc`: `durable_objects` binding + `new_classes` migration for
  `ConnectionHub`.

### 2.10 Not in scope for the server

- Comments as a distinct entity — the rail's 💬 count is chat/conversation count and
  the button just opens chat, matching the design's behavior.
- Share — client-only (`navigator.share`, clipboard fallback). Share cards stay a
  separate FEATURES.md P0 item.
- Follow feed（关注 tab as a filtered feed）— the top tabs are `For You · Topics`
  exactly as the design; a favorites-filtered feed can come later.
- **Group chat orchestration & UI** — the schema is group-ready now
  (`conversations.type`, `conversation_characters`, `sender_character_id` —
  §8.1) and the WS protocol already delivers per-sender bubbles, but
  multi-character turn-taking (who replies, in what order) and the group UI are
  their own feature (P2 群聊模式). Nothing in this feature blocks it; no schema
  change will be needed to add it.

---

## 3. Client work

Replace the current desktop-ish pages with the design's mobile-first shell.
Stack stays: React 19 + react-router + TanStack Query + Tailwind v4 (dark default,
flame-orange brand accent), shadcn primitives where they fit. Rules: no focus rings,
no `window.confirm/alert/prompt`, `useLocalStorage` from usehooks-ts.

### 3.1 Shell & navigation

- `MobileShell` — full-viewport column (100dvh), status-bar spacer, content region,
  `TabBar` (Home / Topics / Chats / Me — icons per design). The Chats tab icon
  shows a brand-colored badge with the total `unread_count` (99+ cap), fed by the
  conversations query (TanStack Query, refetch on window focus). On ≥md screens center a
  phone-width column on near-black backdrop (parity with the kit's framing;
  the repo already has a responsive AppShell commit to build on).
- Routes: `/` (For You feed), `/topics` (reels), `/chats` (inbox), `/me` (profile).
  Chat renders as a **full-screen overlay** (`/chat/:conversationId`) above the shell,
  preserving feed scroll position on back.
- `TopTabs` (`For You · Topics`) floats over the feed screens only.

### 3.2 For You feed

- `FeedPage`: `scroll-snap-type: y mandatory` container, one `PersonaSlide` per
  character from `GET /api/characters`; `ProgressDots` on the right edge tracking
  scroll index.
- `PersonaSlide`: hue-keyed radial-gradient scene, floating emoji w/ glow, bottom
  gradient overlay (@name + verified check, greeting, Start chatting → CTA).
- `ActionRail`: TikTok-style solid filled icons (white, drop-shadow, no button
  chrome; per the `FanMouth Mobile.html` revision) — avatar + follow ＋ (→
  `POST /api/favorites/:id`, flips to ✓), ♥ like (solid heart, fills brand when
  liked; optimistic toggle → `POST /api/characters/:id/like`, pop animation,
  formatted count), 💬 filled bubble (count = `chat_count`; tap = same as CTA),
  ↗ filled share arrow (`navigator.share` / clipboard toast via sonner).
- CTA/💬 → `POST /api/chat/conversations { characterId }` → open chat overlay.
  (Optional dedupe: reuse the owner's latest conversation with that character
  instead of always creating — decide in implementation; inbox exists either way.)

### 3.3 Topics reels

- `TopicsPage`: same snap-feed pattern over `GET /api/topics/today`;
  `TopicSlide` renders heat (`6.7w` formatting: `≥10000 → x.xw`), title, headline,
  #tags, participant avatar row, Chat →.
- Chat → → `POST /api/chat/conversations { characterId: primary, topicId }` → overlay.
- Empty state (no active topics): a single quiet slide directing to the For You feed.

### 3.4 Chat overlay

- Rebuild `Chat.tsx` to the immersive design: hue gradient scene from the character,
  header (back / avatar / name ✓ / ● Online / ★), message list with glass bubbles +
  rise-in animation, typing dots while streaming, pill composer (Enter sends,
  Shift+Enter newline), disabled-send opacity.
- Sending (over the WS, §2.9): append the user bubble optimistically with its
  `clientMsgId`; confirm on `ack` (or remove it and restore the composer on
  `error`). Typing dots are driven by `typing` frames; each incoming `message`
  frame appends a bubble with the rise-in animation — the UI renders 1..N
  bubbles per turn without special-casing. If the socket is down, fall back to
  the REST send (all bubbles arrive at once). ★ → favorites add/remove with
  optimistic update. On open + when `message` frames land in the open chat →
  `mark_read` over the socket (REST `POST …/:id/read` as fallback).
- Rate-limit errors: `GUEST_LIMIT_REACHED` → inline sign-up prompt bubble;
  `RATE_LIMITED` → toast with retry-after.

### 3.5 Inbox

- `ChatsPage`: rows from enriched `GET /api/chat/conversations` — gradient avatar
  (character hue), name, relative time (`now/2m/1h/1d` formatter), one-line preview
  (`last_message.content`), brand unread-count badge when `unread_count > 0`
  (dot upgraded to a count per product decision). Tap → overlay (marks read,
  which zeroes the row badge and decrements the tab total).
- Swipe-to-delete is out; use a long-press/kebab → custom confirm dialog →
  `DELETE /api/chat/conversations/:id`.

### 3.6 Profile

- `MePage` (per the `FanMouth Mobile.html` revision): gradient hero banner with ⚙
  button; avatar circle overlapping the banner (dark border + brand ring);
  `@handle` (user) or guest CTA; bio line w/ favorite team; stat row from
  `GET /api/me/stats` framed by hairline top/bottom borders; **full-width brand
  Edit-profile button** (dialog → `PATCH /api/me/profile`; guests → localStorage
  name/team + signup CTA); ★ FAVORITES as a **horizontal avatar scroller** from
  `GET /api/favorites` (brand-ringed hue-gradient circles + truncated names,
  dashed empty state; tap → start/open chat); SETTINGS card list — Notifications
  (static "On" for P0), Appearance (Dark; wired to the theme hook), Language
  (static "English"), Help & feedback (mailto/link), plus Log out when
  authenticated. Static rows render disabled-quiet; no dead-end alerts.

---

## 4. Migrations summary (one generated migration is fine)

1. `character_likes` — new table (+ partial unique owner×character indexes, character_id index)
2. `character_favorites` — new table (same shape)
3. `conversation_characters` — new table (backfilled from `conversations.character_id`)
4. `conversations` + `type`, `topic_id`, `last_read_seq`
5. `chat_messages` + `seq` (backfilled from rowid order, unique `(conversation_id, seq)`),
   `sender_character_id`, `kind`, `status`, `media_url`, `client_msg_id` (partial unique)
6. `daily_topics` + `headline, heat, tags, character_ids, hue, pinned`
7. `user` + `handle` (unique), `favorite_team`

`bun run db:generate` → `bun run db:migrate` (local) / `db:migrate:prod` via deploy.

## 5. API surface after this feature

| Method | Path | Auth | New/Changed |
| --- | --- | --- | --- |
| GET | /api/characters | guest ok | **changed** — hue, like/chat counts, liked, favorited |
| POST | /api/characters/:id/like | guest ok | **new** — toggle |
| GET | /api/favorites | guest ok | **new** |
| POST/DELETE | /api/favorites/:characterId | guest ok | **new** |
| GET | /api/topics/today | public | **changed** — reel fields |
| POST | /api/topics | admin | **changed** — accepts reel fields |
| POST | /api/chat/conversations | guest ok | **changed** — optional `topicId` |
| GET | /api/ws | guest ok | **new** — WebSocket upgrade → owner's ConnectionHub DO (§2.9) |
| POST | /api/chat/conversations/:id/messages | guest ok | **changed** — SSE removed; REST fallback returning all bubbles in one JSON response (primary send is the WS) |
| GET | /api/chat/conversations | guest ok | **changed** — last_message, unread_count |
| POST | /api/chat/conversations/:id/read | guest ok | **new** |
| GET/PATCH | /api/me/profile | user | **new** |
| GET | /api/me/stats | guest ok | **new** |

## 5.1 Runtime & deployment (confirmed decisions)

- **Runtime: Cloudflare Workers** (`wrangler.jsonc`, smart placement, hourly cron
  trigger already configured). Client assets served from `./dist` with
  `run_worker_first: ["/api/*"]`. Deploy = `bun run deploy`
  (build → `wrangler d1 migrations apply cai-db --remote` → `wrangler deploy`).
- **Database: Cloudflare D1** (SQLite). This is why the new topic `tags` /
  `character_ids` columns are JSON-in-`text` and why timestamps use SQLite
  expressions (`unixepoch()`), not JS `Date` — see §6.
- **Chat engine: OpenRouter** (`server/lib/llm.ts`, plain `fetch`, zero SDK deps —
  Workers-compatible by construction). Config: `OPENROUTER_API_KEY` secret
  (+ optional `OPENROUTER_MODEL`, default `anthropic/claude-haiku-4.5`), already in
  `.env.example`; prod secrets pushed with `bun run secrets:push` from `.env.prod`.
- **Transport: WebSocket for chat delivery, REST for reads** (product decision,
  §2.9). Two requirements drive it: **no polling anywhere**, and **a character
  may send multiple messages per user turn** (and eventually delayed/proactive
  ones) — request/response can only ever return one reply to one request, so
  push is structural, not cosmetic. No token streaming: every message arrives
  as one complete frame. Server push on Workers means **Durable Objects**
  (one `ConnectionHub` DO per owner). D1 stays the source of truth; the socket
  is delivery-only, and a reconnect reconciles with one REST fetch (that's
  recovery, not polling).
- **Long generations (product assumption: first output may take >3 minutes once
  image/video replies land)**: anything with minutes-long first-byte runs as an
  **async job** (accept → pending message row → generate in background via
  Queues → result pushed over the owner's WebSocket the moment it's ready).
  Holding any single HTTP request open for 3+ silent minutes is not viable on
  mobile. Design in §8.9.
- **No Redis (or any external state service).** The jobs Redis usually does in
  a WebSocket architecture are covered by platform primitives here: pub/sub
  routing ("which server holds user X's socket?") → the `ConnectionHub` DO *is*
  the addressable socket holder (`idFromName(ownerKey)`); hot counters (rate
  limits, dedup) → DO storage, single-writer by construction; queues → CF
  Queues; cache → not needed at this scale (and Workers KV/Cache API before
  Redis if ever). Adding Redis would mean an external service + HTTP-proxied
  access from Workers for strictly less consistency than the DO already gives.
- **Rate limiting is per-isolate** (in-memory `Map`, documented in
  `server/lib/rateLimit.ts`). Accepted for P0: limits are approximate across
  isolates/regions. The new like/favorite endpoints inherit the same caveat —
  their unique DB indexes are the real integrity backstop; the limiter is only
  cost control. If limits must become strict later: Durable Objects or the CF
  Rate Limiting binding, out of scope here.

## 5.2 Known risks & practical caveats (eyes-open list)

1. **Local dev must move to workerd for the WS/DO work.** Today `bun run local`
   runs the Hono server in plain Bun (`server/dev.ts`) — Durable Objects,
   Queues, and WS hibernation **do not exist there**. The chat-transport phase
   switches local dev to `wrangler dev` (workerd emulates DO/D1/Queues/R2
   locally; the repo's `preview` script already does this). Vite keeps serving
   the client; its proxy needs `ws: true` for `/api/ws`. Non-DO endpoints can
   keep the fast Bun loop during earlier phases.
2. **Plan requirements.** Cloudflare **Queues requires Workers Paid**; Durable
   Objects are available on Free (SQLite-backed) but with tighter limits.
   Confirm the account is on Paid before the media phase; the WS phase itself
   runs on Free-tier DOs if needed.
3. **Multi-bubble output depends on model formatting.** The `---` split is
   best-effort by design — worst case the character sends one bubble (graceful,
   not broken). Don't spend P0 time chasing split fidelity.
4. **Schedule.** P0 target (World Cup final, 2026-07-19) is tight for the full
   WS layer. The design de-risks this deliberately: the REST fallback endpoint
   is the same service code, so chat ships working request/response first and
   the DO/WS layer activates on top without client-visible API changes —
   if the date wins, WS slips a few days, not the launch.

## 6. Cross-cutting rules

- Every new owner-scoped query uses the existing `Owner = {userId} | {guestId}`
  filter; **never** trust a bare entity id (AGENT.md parent-scope rule).
- All new endpoints: Zod-validated bodies, `ok()/fail()` responses, snake_case columns.
- Timestamps in SQL, never `new Date()` inside `.set()`.
- Like/favorite toggles are idempotent and race-safe (unique index + upsert/ignore).
- Rate limiting: reuse existing limiters for chat; like/favorite toggles get a light
  shared limiter (e.g. 120/h per owner) to keep guests from hammering counters.

## 7. Suggested build order

1. **Migrations + characters repo** (2.1, 2.2, 2.3) — likes/favorites/counters live
2. **Chat transport: SSE → WebSocket** (2.9) — ConnectionHub DO + frame
   protocol + multi-bubble service + REST fallback; unblocks client chat work
3. **Topics enrichment + topic-seeded chat** (2.4, 2.5)
3. **Inbox enrichment + read state** (2.6)
4. **Profile fields + stats + guest→account merge** (2.7, 2.8)
5. **Client shell + For You feed + action rail** (3.1, 3.2)
6. **Topics reels + chat overlay** (3.3, 3.4)
7. **Inbox + profile screens** (3.5, 3.6)
8. Polish: animations (float/pop/rise/blink per design keyframes), number formatting,
   empty states, guest sign-up prompts

Each server phase lands with vitest coverage for the new repos/routes
(`bun run test:server`); client phases verified against `bun run local`.

## 8. Backend technical design

How the server work in §2 is actually built, in this repo's patterns
(feature folders, repo/service/router layering, D1/SQLite).

### 8.1 Schema details & the NULL-unique gotcha

`character_likes` and `character_favorites` (identical shape):

```ts
export const character_likes = sqliteTable('character_likes', {
  id: text('id').primaryKey(),
  user_id: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
  guest_id: text('guest_id'),
  character_id: text('character_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull()
    .$defaultFn(() => new Date()),
}, (t) => [
  // SQLite treats NULLs as distinct in unique indexes, so a plain
  // unique(user_id, character_id) would NOT dedupe guest rows (user_id NULL).
  // Two partial unique indexes instead:
  uniqueIndex('likes_user_char_uq').on(t.user_id, t.character_id)
    .where(sql`user_id IS NOT NULL`),
  uniqueIndex('likes_guest_char_uq').on(t.guest_id, t.character_id)
    .where(sql`guest_id IS NOT NULL`),
  index('likes_character_id_idx').on(t.character_id),
])
```

**Chat domain DDL (target shape — supports DMs now, group chat later).**
Three requirements shape it: (1) one user turn produces **multiple bubbles**, so
ordering can't ride second-granularity timestamps → per-conversation `seq`;
(2) **group chat** means "who spoke" is a character id, not just a role, and a
thread has N participants; (3) media replies have a **lifecycle** (pending →
ready/failed), text doesn't.

```sql
-- conversations: one thread; type 'dm' (one character) or 'group' (N characters)
CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,                          -- uuid
  type          TEXT NOT NULL DEFAULT 'dm',                -- 'dm' | 'group'
  user_id       TEXT REFERENCES user(id) ON DELETE RESTRICT,
  guest_id      TEXT,                                      -- exactly one of user_id/guest_id (app-enforced;
                                                           --  a CHECK would need a D1 table rebuild)
  character_id  TEXT NOT NULL,   -- primary character: the DM partner / group "host"; drives inbox avatar
  topic_id      TEXT,            -- daily_topics.id that seeded the chat (no FK: topics soft-deactivate)
  title         TEXT,
  last_read_seq INTEGER NOT NULL DEFAULT 0,                -- owner's read cursor (see §2.6)
  created_at    INTEGER NOT NULL,                          -- epoch seconds, display only
  updated_at    INTEGER NOT NULL
);
CREATE INDEX conversations_user_idx  ON conversations(user_id, updated_at);
CREATE INDEX conversations_guest_idx ON conversations(guest_id, updated_at);

-- thread membership (characters; the human is the owner above).
-- DM: exactly one row. Group: N rows. Multi-human groups later = additional
-- member columns/rows here (per-member read cursors move here too) — an
-- extension, not a rework.
CREATE TABLE conversation_characters (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  character_id    TEXT NOT NULL,
  joined_at       INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, character_id)
);

-- chat_messages: one row per bubble (user or character, text or media)
CREATE TABLE chat_messages (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL,        -- per-conversation monotonic; THE order + read cursor
  role                TEXT NOT NULL,           -- 'user' | 'assistant' ('system' reserved)
  sender_character_id TEXT,                    -- NULL = the human; set on every assistant bubble
                                               --  (group chat needs it; DMs get it for free)
  kind                TEXT NOT NULL DEFAULT 'text',       -- 'text' | 'image' | 'video'
  status              TEXT NOT NULL DEFAULT 'complete',   -- 'complete' | 'pending' | 'ready' | 'failed'
  content             TEXT NOT NULL DEFAULT '',           -- text body / media caption / failure fallback
  media_url           TEXT,                    -- R2 key once status='ready'
  client_msg_id       TEXT,                    -- WS resend idempotency (user messages)
  created_at          INTEGER NOT NULL         -- display only, never ordering
);
CREATE UNIQUE INDEX messages_conv_seq_uq    ON chat_messages(conversation_id, seq);
CREATE UNIQUE INDEX messages_conv_client_uq ON chat_messages(conversation_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
```

- **`seq` assignment**: the owner's `ConnectionHub` DO is a single writer per
  owner, so `MAX(seq)+1` per conversation is race-free on the primary path; the
  REST fallback assigns via `INSERT … SELECT COALESCE(MAX(seq),0)+1` inside a
  `db.batch()` (serialized per D1 database). Multi-bubble turns take
  consecutive seqs in one batch.
- **`(conversation_id, seq)` unique index** doubles as the message-fetch and
  unread-count driver — no separate `created_at` index needed.
- **`client_msg_id` partial unique index** makes resend idempotency durable
  (the DO's in-memory record is just a fast path).
- **Group chat readiness, DM cost**: for DMs everything behaves as today —
  `conversation_characters` has one row, `sender_character_id` mirrors
  `character_id`. Group chat later adds rows + orchestration; zero schema change.

Migration from the existing tables (all D1-legal `ALTER TABLE ADD COLUMN`s —
nullable or literal default): add the new columns, backfill `seq` from `rowid`
order per conversation, backfill `conversation_characters` from
`conversations.character_id`, seed `last_read_seq = MAX(seq)` (nothing suddenly
unread on deploy). The one-owner-column rule and enum-ish values stay
app-enforced (Zod/service) — D1 can't add CHECKs without a table rebuild.

Other column additions:

- `daily_topics`: `headline text NOT NULL DEFAULT ''`, `heat integer NOT NULL
  DEFAULT 0`, `tags text NOT NULL DEFAULT '[]'`, `character_ids text NOT NULL
  DEFAULT '[]'`, `hue integer NOT NULL DEFAULT 28`, `pinned integer NOT NULL
  DEFAULT 0`
- `user`: `handle text` + unique index, `favorite_team text`

Timestamps: Drizzle `{ mode: 'timestamp' }` stores epoch **seconds**; inserts via
`$defaultFn(() => new Date())` are fine (epoch is timezone-independent — the
AGENT.md PG caveat doesn't bite here), but SQL-side updates use
`sql\`(unixepoch())\`` for consistency (e.g. `touchConversation`). Timestamps are
display-only; ordering and read state ride `seq`.

### 8.2 Character counters without N+1

Characters live in code, so `GET /api/characters` assembles counts from **one
`db.batch()`** (D1 batches run as a single implicit transaction / round trip):

1. `SELECT character_id, COUNT(*) n FROM character_likes GROUP BY character_id`
2. `SELECT character_id, COUNT(*) n FROM conversations GROUP BY character_id`
3. owner's liked ids (`WHERE user_id = ? / guest_id = ?`)
4. owner's favorited ids

Merge into the static roster in `server/features/characters/repo.ts` (new file —
holds only counter queries; persona data stays in `data.ts`). `like_count =
seed_likes + n₁`, `chat_count = seed_chats + n₂`. No caching for P0; four indexed
group-bys over small tables is nothing.

### 8.3 Race-safe like toggle (no read-then-write)

```ts
// repo: returns the new state without a prior SELECT
const inserted = await db.insert(character_likes)
  .values({ id: crypto.randomUUID(), ...ownerCols(owner), character_id })
  .onConflictDoNothing()
  .returning({ id: character_likes.id })
if (inserted.length > 0) return { liked: true }
await db.delete(character_likes).where(and(ownerFilter(owner), eq(character_id)))
return { liked: false }
```

Two concurrent toggles can't double-insert (partial unique index) and the worst
race outcome is an extra no-op delete. Favorites skip toggling entirely:
`POST` = insert-on-conflict-do-nothing, `DELETE` = delete — both idempotent,
so client retries are always safe. Favorites repo exports `ownerFilter`-style
helpers reused from a shared `server/features/shared/owner.ts` (extract the
existing one from `chat/repo.ts` rather than duplicating it).

### 8.4 Inbox: last message + unread_count in one query

Correlated scalar subqueries (SQLite is good at these with the composite index),
built with Drizzle `sql` fragments inside the existing `findConversations`:

```sql
SELECT c.*,
  (SELECT content FROM chat_messages m
    WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1) AS last_content,
  (SELECT kind FROM chat_messages m
    WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1) AS last_kind,
  (SELECT role FROM chat_messages m
    WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1) AS last_role,
  (SELECT COUNT(*) FROM chat_messages m
    WHERE m.conversation_id = c.id AND m.role = 'assistant'
      AND m.seq > c.last_read_seq) AS unread_count
FROM conversations c
WHERE <ownerFilter> ORDER BY c.updated_at DESC
```

All four subqueries ride the `(conversation_id, seq)` unique index.
`insertConversation` sets `last_read_seq` to the greeting's seq so the scripted
greeting is never unread; mark-read (WS frame or REST fallback) sets
`last_read_seq = MAX(seq)` owner-scoped, per §2.6.

### 8.5 Topics: JSON columns at the boundary

- Repo returns raw rows; the **router** owns (de)serialization: parse with
  `z.string().transform(s => JSON.parse(s)).pipe(z.array(z.string())).catch([])`
  so a hand-edited bad row degrades to `[]` instead of a 500.
- Admin create: Zod validates `tags` (≤8, each ≤24 chars), `character_ids`
  against the roster (`getCharacter` each id → 400 `UNKNOWN_CHARACTER` on miss),
  `hue` 0–360, `heat ≥ 0`; router stringifies before insert.
- `GET /topics/today` expands `character_ids` → `{id, name, emoji}` via the
  roster (in-memory, no query) and sorts `pinned DESC, created_at DESC` in SQL.

### 8.6 Topic-seeded chat plumbing

- New repo fn `findTopicById(db, id)` (active only).
- `createConversationWithGreeting` gains an optional `topic` param → stored on the
  row. `streamReply` already receives the conversation via the router; the router
  passes `conversation.topic_id` through, and `buildSystemPrompt(db, character,
  seededTopic?)` appends: `【本次对话来源】用户是从话题「{title}」进入的：{content}——
  开场和前几轮优先围绕这个话题展开。` Daily-topic injection stays as-is (the seeded
  topic may also appear there; the dedicated section just gives it priority).

### 8.7 Guest→account merge: lazy middleware, not an auth hook

better-auth hooks don't reliably see our `guest_id` cookie across every login
path (email, OAuth callback, refresh). Instead: a small `mergeGuestData`
middleware mounted after `jwtAuth` on `/api/*` —

```
if (c.get('user') && guestCookie) {
  await mergeGuest(db, guestCookie, user.userId)   // idempotent
  clearGuestCookie(c)
}
```

`mergeGuest` runs one `db.batch()`:
1. delete guest likes/favorites that collide with existing user rows
   (`WHERE guest_id = ? AND character_id IN (SELECT character_id FROM … WHERE user_id = ?)`)
2. `UPDATE character_likes/character_favorites/conversations
   SET user_id = ?, guest_id = NULL WHERE guest_id = ?`

Idempotent by construction (second run matches zero rows), covers sign-up,
sign-in, *and* returning users on a new device, and costs one batch only on the
first authenticated request that still carries a guest cookie.

### 8.8 Profile & stats

- `server/features/users/router.ts` (new): `GET /me/profile` reads the user row;
  `PATCH /me/profile` lowercases `handle`, validates `^[a-z0-9_]{3,20}$`, and
  relies on the unique index — catch the constraint violation → 409
  `HANDLE_TAKEN` (no check-then-insert race).
- `GET /me/stats`: one `db.batch()` of three owner-scoped `COUNT(*)`s
  (conversations, favorites, likes). Works for guests via the same `Owner` filter.

### 8.9 Long-running generations — async message pipeline (§5.1 assumption)

Why not one held-open request for a 3-minute generation: the client side can't be
trusted for minutes — phones lock, apps background, radios drop, and the
connection dies with them (this kills SSE and WebSocket alike). The reply must
not depend on the request that asked for it.

**Split by latency class, not by endpoint:**

- **Text replies (P0)**: generated inside the owner's `ConnectionHub` DO and
  pushed as `message` frames (§2.9) — seconds-scale, no job machinery needed.
- **Media replies (image/video, when they land)**: async job —
  1. `POST .../messages` inserts the user message **and** an assistant message row
     with `status='pending'`, `kind='image'|'video'`, then returns `202` with both
     rows immediately. Nothing blocks.
  2. Generation runs in a **Cloudflare Queue consumer** (producer binding in
     `wrangler.jsonc`; consumers get ~15 min wall-clock and built-in retries —
     `waitUntil` is not reliable at these durations). A Queues→Workflows upgrade
     is mechanical if steps/multi-stage pipelines appear later.
  3. Output lands in **R2**; the consumer updates the message row to
     `status='ready'`, `media_url=<r2 key>` (or `status='failed'` + fallback text
     after retries are exhausted). Note: the media path is the one place a
     pending assistant row exists before its content does — the §2.9 atomic
     text path never creates pending rows.
  4. Client discovery is **push, not polling**: after updating D1, the queue
     consumer calls the owner's `ConnectionHub` DO (`stub.fetch` by
     `idFromName(ownerKey)`), which pushes the ready message as a normal
     `message` frame (or `unread_update` if that chat isn't open). If no socket
     is connected, nothing is pushed — the reconcile-fetch on next app
     open/reconnect delivers it, and the inbox `unread_count` surfaces it.
     **Web Push (P1)** covers the app-closed case, piggybacking on the planned
     赛后召回 channel.

Schema impact: none beyond §8.1 — `kind`/`status`/`media_url` ship in this
feature's chat DDL precisely so media lands later with zero schema change. The
text path never touches them (defaults apply).

### 8.10 Tests (vitest, existing `server` project, better-sqlite3)

- Repo level: partial-unique enforcement (double like by same guest = 1 row),
  toggle semantics, unread_count math (greeting excluded; count resets on read),
  merge idempotency + collision handling.
- Router level: Zod rejections, 404s (unknown character/topic), 409 handle
  conflict, owner isolation (guest A can't read guest B's conversations —
  extends the existing pattern).
- Chat service (multi-bubble split, persistence, error paths) is tested through
  the REST fallback seam — no socket needed. `ConnectionHub` frame protocol
  (ack/typing/message ordering, clientMsgId idempotency, hibernation wake) gets
  workerd-runtime integration tests via `@cloudflare/vitest-pool-workers`.

## 9. Open questions (non-blocking, defaults chosen)

1. **Seeded counters** — launch with display bases (`seed_likes`/`seed_chats`) so the
   feed looks alive, or honest zeros? *Default in this doc: seeded bases.*
2. **Profile "Likes" stat** — likes **given** (default here) vs likes received
   (meaningless until UGC exists).
3. **Feed CTA behavior** — always create a new conversation vs reuse the latest one
   with that character. *Default: reuse latest (keeps the inbox tidy; matches how the
   design's inbox shows one thread per character).*
