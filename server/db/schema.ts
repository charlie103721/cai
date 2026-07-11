import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core'

// ─── better-auth tables ──────────────────────────────────────

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    // Role is a plain text column so adding new values is a zero-migration
    // change at the app layer. Vocabulary is defined in
    // server/features/users/roles.ts (USER_ROLES const). Registered with
    // better-auth via `additionalFields` in server/lib/auth.ts with
    // `input: false` so sign-up / update-user API calls can't set it.
    role: text('role').notNull().default('user'),
    // App-owned profile fields (snake_case). Nullable so the ALTER is D1-legal.
    handle: text('handle'),
    favorite_team: text('favorite_team'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('user_handle_unique').on(t.handle)],
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('session_userId_idx').on(t.userId), index('session_token_idx').on(t.token)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
    scope: text('scope'),
    idToken: text('idToken'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('account_userId_idx').on(t.userId),
    uniqueIndex('account_providerId_accountId_idx').on(t.providerId, t.accountId),
  ],
)

// ─── app tables ──────────────────────────────────────

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    // Exactly one of user_id / guest_id identifies the owner. Guests get a
    // cookie-based UUID; on sign-up their conversations can be merged over.
    user_id: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
    guest_id: text('guest_id'),
    character_id: text('character_id').notNull(),
    title: text('title'),
    // DM today, group later with zero schema change. App-enforced enum ('dm'|'group').
    type: text('type').notNull().default('dm'),
    // Set when the conversation was seeded from a daily topic.
    topic_id: text('topic_id'),
    // Read-state rides seq, never timestamps.
    last_read_seq: integer('last_read_seq').notNull().default(0),
    created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('conversations_user_id_idx').on(t.user_id),
    index('conversations_guest_id_idx').on(t.guest_id),
  ],
)

export const chat_messages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    conversation_id: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    // Per-conversation monotonic order/read cursor. Timestamps are display-only.
    seq: integer('seq').notNull().default(0),
    // Which character authored an assistant message (group-chat ready).
    sender_character_id: text('sender_character_id'),
    // Media-ready schema (app-enforced enums): kind 'text'|..., status 'complete'|...
    kind: text('kind').notNull().default('text'),
    status: text('status').notNull().default('complete'),
    media_url: text('media_url'),
    // Client-supplied idempotency key for send retries.
    client_msg_id: text('client_msg_id'),
    created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('chat_messages_conversation_id_idx').on(t.conversation_id),
    uniqueIndex('chat_messages_conversation_id_seq_unique').on(t.conversation_id, t.seq),
    // SQLite treats NULLs as distinct, so scope the uniqueness to real ids only.
    uniqueIndex('chat_messages_conversation_id_client_msg_id_unique')
      .on(t.conversation_id, t.client_msg_id)
      .where(sql`${t.client_msg_id} IS NOT NULL`),
  ],
)

export const daily_topics = sqliteTable(
  'daily_topics',
  {
    id: text('id').primaryKey(),
    topic_date: text('topic_date').notNull(), // YYYY-MM-DD (UTC)
    title: text('title').notNull(),
    content: text('content').notNull(),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // Reel display fields (JSON-in-text for tags/character_ids; app parses).
    headline: text('headline').notNull().default(''),
    heat: integer('heat').notNull().default(0),
    tags: text('tags').notNull().default('[]'),
    character_ids: text('character_ids').notNull().default('[]'),
    hue: integer('hue').notNull().default(28),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('daily_topics_topic_date_idx').on(t.topic_date)],
)

// Owner-scoped engagement rows: exactly one of user_id / guest_id is set.
// SQLite treats NULLs as distinct, so a plain unique index would NOT dedupe
// guest rows — each partial unique index is scoped to a non-null owner column.
export const character_likes = sqliteTable(
  'character_likes',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
    guest_id: text('guest_id'),
    character_id: text('character_id').notNull(),
    created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('character_likes_user_character_unique')
      .on(t.user_id, t.character_id)
      .where(sql`${t.user_id} IS NOT NULL`),
    uniqueIndex('character_likes_guest_character_unique')
      .on(t.guest_id, t.character_id)
      .where(sql`${t.guest_id} IS NOT NULL`),
    index('character_likes_character_id_idx').on(t.character_id),
  ],
)

export const character_favorites = sqliteTable(
  'character_favorites',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
    guest_id: text('guest_id'),
    character_id: text('character_id').notNull(),
    created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('character_favorites_user_character_unique')
      .on(t.user_id, t.character_id)
      .where(sql`${t.user_id} IS NOT NULL`),
    uniqueIndex('character_favorites_guest_character_unique')
      .on(t.guest_id, t.character_id)
      .where(sql`${t.guest_id} IS NOT NULL`),
    index('character_favorites_character_id_idx').on(t.character_id),
  ],
)

// Conversation membership: DMs today, group chat later with zero schema change.
export const conversation_characters = sqliteTable(
  'conversation_characters',
  {
    conversation_id: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    character_id: text('character_id').notNull(),
    joined_at: integer('joined_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.conversation_id, t.character_id] })],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)
