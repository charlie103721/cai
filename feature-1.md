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
  `POST /api/chat/conversations/:id/messages` → SSE streaming via OpenRouter.
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

### 2.6 Chats inbox — enrich list + read state (migration: 1 column)

- `conversations` gains nullable `last_read_at timestamp`.
- `GET /api/chat/conversations` rows additionally return:
  - `last_message: { role, content, created_at } | null` (subquery: latest message),
  - `unread_count: number` — count of **assistant** messages with
    `created_at > last_read_at`. Brand-new conversations are marked read at
    creation (`last_read_at = now`) so the scripted greeting doesn't count.
  - Client derives the **total unread** (for the Chats tab badge) by summing
    `unread_count` across rows — no extra endpoint needed.
- `POST /api/chat/conversations/:id/read` — sets `last_read_at = now` (owner-scoped).
  Client calls it on opening a chat and on `done` of each stream.
- Use `sql\`now()\``-equivalent SQLite expression per AGENT.md UTC rule
  (`unixepoch()` — never JS `new Date()` in `.set()`).

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

### 2.9 Not in scope for the server

- Comments as a distinct entity — the rail's 💬 count is chat/conversation count and
  the button just opens chat, matching the design's behavior.
- Share — client-only (`navigator.share`, clipboard fallback). Share cards stay a
  separate FEATURES.md P0 item.
- Follow feed（关注 tab as a filtered feed）— the top tabs are `For You · Topics`
  exactly as the design; a favorites-filtered feed can come later.

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
- Reuse `client/src/lib/chat.ts` SSE client. ★ → favorites add/remove with optimistic
  update. On open + on stream `done` → `POST …/:id/read`.
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

1. `character_likes` — new table (+ unique owner×character indexes, character_id index)
2. `character_favorites` — new table (same shape)
3. `daily_topics` + `headline, heat, tags, character_ids, hue, pinned`
4. `conversations` + `topic_id`, `last_read_at`
5. `user` + `handle` (unique), `favorite_team`

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
- **Streaming: SSE over HTTP** (`streamSSE`), not WebSockets — one-directional
  reply streaming needs no Durable Objects. Unread badges are pull-based
  (query refetch), consistent with this.
- **Long generations (product assumption: first output may take >3 minutes once
  image/video replies land)**: text keeps synchronous SSE, but anything with
  minutes-long first-byte runs as an **async job** (accept → 202 + pending
  message row → generate in background → client discovers completion by
  polling/refetch). Holding one HTTP stream open for 3+ silent minutes is not
  viable on mobile. Design in §8.10.
- **Rate limiting is per-isolate** (in-memory `Map`, documented in
  `server/lib/rateLimit.ts`). Accepted for P0: limits are approximate across
  isolates/regions. The new like/favorite endpoints inherit the same caveat —
  their unique DB indexes are the real integrity backstop; the limiter is only
  cost control. If limits must become strict later: Durable Objects or the CF
  Rate Limiting binding, out of scope here.

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
2. **Topics enrichment + topic-seeded chat** (2.4, 2.5)
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

Column additions (SQLite `ALTER TABLE ADD COLUMN` — every new column is either
nullable or has a literal default, which is all D1 allows):

- `conversations`: `topic_id text`, `last_read_at integer` (timestamp, NULL)
- `daily_topics`: `headline text NOT NULL DEFAULT ''`, `heat integer NOT NULL
  DEFAULT 0`, `tags text NOT NULL DEFAULT '[]'`, `character_ids text NOT NULL
  DEFAULT '[]'`, `hue integer NOT NULL DEFAULT 28`, `pinned integer NOT NULL
  DEFAULT 0`
- `user`: `handle text` + unique index, `favorite_team text`
- New composite index `chat_messages(conversation_id, created_at)` — replaces the
  single-column index as the driver for both inbox subqueries (§8.4).

Timestamps: Drizzle `{ mode: 'timestamp' }` stores epoch **seconds**; inserts via
`$defaultFn(() => new Date())` are fine (epoch is timezone-independent — the
AGENT.md PG caveat doesn't bite here), but SQL-side updates use
`sql\`(unixepoch())\`` for consistency (e.g. `last_read_at`, `touchConversation`).

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
    WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_content,
  (SELECT role FROM chat_messages m
    WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_role,
  (SELECT COUNT(*) FROM chat_messages m
    WHERE m.conversation_id = c.id AND m.role = 'assistant'
      AND m.created_at > COALESCE(c.last_read_at, 0)) AS unread_count
FROM conversations c
WHERE <ownerFilter> ORDER BY c.updated_at DESC
```

`insertConversation` sets `last_read_at = now` so the scripted greeting is never
unread. `POST /:id/read` is a one-line owner-scoped
`UPDATE conversations SET last_read_at = (unixepoch())`.

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

Why not SSE-with-heartbeats for a 3-minute generation: the Worker *can* satisfy
proxy TTFB by emitting heartbeat frames immediately, but the client side can't be
trusted for minutes — phones lock, apps background, radios drop, and the fetch
stream dies with them. The reply must not depend on the request that asked for it.

**Split by latency class, not by endpoint:**

- **Text replies (P0)**: unchanged — synchronous SSE, ~1s to first token.
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
     after retries are exhausted).
  4. Client discovery is **pull-based, reusing the unread machinery**: the chat
     screen polls `GET /conversations/:id` on a gentle interval while a pending
     message exists (backoff: 3s → 10s → 30s), and the inbox's `unread_count`
     already surfaces completions that arrive while the user is elsewhere —
     a ready media message is just a new unread assistant message. Web Push is
     the P1 upgrade, piggybacking on the planned 赛后召回 channel.

Schema impact (folded into this feature's migration so media needs no second
migration later): `chat_messages` gains `kind text NOT NULL DEFAULT 'text'`,
`status text NOT NULL DEFAULT 'complete'`, `media_url text`. The SSE text path
sets nothing new (defaults apply); repo queries are unaffected.

### 8.10 Tests (vitest, existing `server` project, better-sqlite3)

- Repo level: partial-unique enforcement (double like by same guest = 1 row),
  toggle semantics, unread_count math (greeting excluded; count resets on read),
  merge idempotency + collision handling.
- Router level: Zod rejections, 404s (unknown character/topic), 409 handle
  conflict, owner isolation (guest A can't read guest B's conversations —
  extends the existing pattern).

## 9. Open questions (non-blocking, defaults chosen)

1. **Seeded counters** — launch with display bases (`seed_likes`/`seed_chats`) so the
   feed looks alive, or honest zeros? *Default in this doc: seeded bases.*
2. **Profile "Likes" stat** — likes **given** (default here) vs likes received
   (meaningless until UGC exists).
3. **Feed CTA behavior** — always create a new conversation vs reuse the latest one
   with that character. *Default: reuse latest (keeps the inbox tidy; matches how the
   design's inbox shows one thread per character).*
