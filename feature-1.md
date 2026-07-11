# Feature 1 — FanMouth（球迷嘴替）TikTok-style App

> Implements the design at `ui_kits/qiumi-app/index.html` in the Claude Design project
> (claude.ai/design project `ebfc85b0-bb48-4eed-92e0-edca6dabbdf3`): a dark, full-bleed,
> mobile-first vertical swipe feed of AI fan personas, topic reels, immersive chat,
> a chats inbox, and a profile screen.
>
> Scope: **full stack** — client UI rebuild + server/DB changes that back it.
> Everything must work for **guests and registered users** (design removed login as a
> gate; auth stays available but is never required to use the app).

---

## 0. Design reference

| Design element | Notes |
| --- | --- |
| For You feed（推荐） | Full-screen vertical scroll-snap feed, one persona per slide: radial-gradient scene keyed by per-character `hue`, giant floating emoji, right-side action rail (follow ＋ / ♥ like / 💬 comment→chat / ↗ share), bottom overlay with @name ✓, greeting hook, "Start chatting →" CTA. Right-edge progress dots. |
| Topics reels（话题） | Full-screen reels per daily topic: 🔥 emoji, `Today's Topic · Heat 6.7w`, short title, big headline question, #tags, participating-persona avatars, "Chat →" seeds a chat with the linked character. |
| Immersive chat | Full-bleed overlay above the tab bar: back / avatar / name ✓ / ● Online / ★ favorite header; glass bubbles (assistant = white glass left, user = brand flame right); typing indicator; pill composer + send. |
| Chats inbox（消息） | Conversation list rows: gradient avatar, name, relative time, last-message preview (single line, ellipsis), unread dot. |
| Profile（我的） | Avatar, @handle, bio line with supported team (`World Cup die-hard · Team 🇦🇷`), stat row (Chats / Favorites / Likes), Edit profile + settings buttons, ★ FAVORITES list (empty state included). |
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
  - `unread: boolean` — latest **assistant** message `created_at > last_read_at`
    (or `last_read_at` null and an assistant message exists beyond the greeting…
    simplest correct rule: `unread = last assistant message newer than last_read_at`,
    with brand-new conversations marked read at creation).
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

### 2.8 Not in scope for the server

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
  `TabBar` (Home / Topics / Chats / Me — icons per design). On ≥md screens center a
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
- `ActionRail`: avatar + follow ＋ (→ `POST /api/favorites/:id`, flips to ✓),
  ♥ like (optimistic toggle → `POST /api/characters/:id/like`, pop animation,
  formatted count), 💬 (count = `chat_count`; tap = same as CTA), ↗ share
  (`navigator.share` / clipboard toast via sonner).
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
  (`last_message.content`), brand unread dot when `unread`. Tap → overlay.
- Swipe-to-delete is out; use a long-press/kebab → custom confirm dialog →
  `DELETE /api/chat/conversations/:id`.

### 3.6 Profile

- `MePage`: avatar (emoji circle), `@handle` (user) or guest CTA, bio line w/
  favorite team, stat row from `GET /api/me/stats`, Edit profile (dialog →
  `PATCH /api/me/profile`; guests → localStorage name/team + signup CTA),
  settings button (theme/logout for now), FAVORITES list from `GET /api/favorites`
  with the design's dashed-border empty state; tap row → start/open chat.

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
| GET | /api/chat/conversations | guest ok | **changed** — last_message, unread |
| POST | /api/chat/conversations/:id/read | guest ok | **new** |
| GET/PATCH | /api/me/profile | user | **new** |
| GET | /api/me/stats | guest ok | **new** |

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
4. **Profile fields + stats** (2.7)
5. **Client shell + For You feed + action rail** (3.1, 3.2)
6. **Topics reels + chat overlay** (3.3, 3.4)
7. **Inbox + profile screens** (3.5, 3.6)
8. Polish: animations (float/pop/rise/blink per design keyframes), number formatting,
   empty states, guest sign-up prompts

Each server phase lands with vitest coverage for the new repos/routes
(`bun run test:server`); client phases verified against `bun run local`.

## 8. Open questions (non-blocking, defaults chosen)

1. **Seeded counters** — launch with display bases (`seed_likes`/`seed_chats`) so the
   feed looks alive, or honest zeros? *Default in this doc: seeded bases.*
2. **Profile "Likes" stat** — likes **given** (default here) vs likes received
   (meaningless until UGC exists).
3. **Feed CTA behavior** — always create a new conversation vs reuse the latest one
   with that character. *Default: reuse latest (keeps the inbox tidy; matches how the
   design's inbox shows one thread per character).*
