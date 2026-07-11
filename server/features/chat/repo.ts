import { eq, and, desc, asc, gt, getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { DB } from '../../db'
import { conversations, chat_messages, conversation_characters } from '../../db/schema'
import { ownerFilter as sharedOwnerFilter, ownerColumns, type Owner } from '../shared/owner'

// 归属逻辑已抽到 shared/owner，这里保留同名类型/薄封装以兼容既有调用。
export type { Owner }

/** 会话行 / 消息行的推断类型（服务层/路由层复用）。 */
export type Conversation = typeof conversations.$inferSelect
export type ChatMessage = typeof chat_messages.$inferSelect

const ownerFilter = (owner: Owner) => sharedOwnerFilter(conversations, owner)

/**
 * D1 的 db.batch 是一次事务、串行执行；测试用的 better-sqlite3 没有 batch，
 * 退化为逐条 await（同样串行，保证 seq 内联子查询能看到前一条插入）。
 */
export async function runBatch(db: DB, queries: readonly unknown[]): Promise<unknown[]> {
  const runner = db as unknown as { batch?: (q: readonly unknown[]) => Promise<unknown[]> }
  if (typeof runner.batch === 'function') return runner.batch(queries)
  const results: unknown[] = []
  for (const q of queries) results.push(await q)
  return results
}

/** 内联 seq：取本会话当前 MAX(seq)+1；批次串行执行时每条都能看到上一条。 */
const nextSeqExpr = (conversationId: string): SQL =>
  sql`coalesce((select max(${chat_messages.seq}) from ${chat_messages} where ${chat_messages.conversation_id} = ${conversationId}), 0) + 1`

// ─── 会话 ──────────────────────────────────────

/** 新建会话的插入 query（不立即执行，供 batch 组装）。 */
export function conversationInsertQuery(
  db: DB,
  owner: Owner,
  characterId: string,
  opts: { id?: string; topicId?: string | null; lastReadSeq?: number } = {},
) {
  return db
    .insert(conversations)
    .values({
      id: opts.id ?? crypto.randomUUID(),
      ...ownerColumns(owner),
      character_id: characterId,
      topic_id: opts.topicId ?? null,
      last_read_seq: opts.lastReadSeq ?? 0,
    })
    .returning()
}

export async function insertConversation(db: DB, owner: Owner, characterId: string) {
  const [row] = await conversationInsertQuery(db, owner, characterId)
  return row
}

/**
 * 收件箱列表：随行相关子查询取「最后一条消息」的内容/角色/kind/时间，
 * 以及未读数（assistant 且 seq > last_read_seq）。子查询走 (conversation_id, seq) 索引。
 */
export async function findConversations(db: DB, owner: Owner) {
  // drizzle 在 sql`` 模板里把 ${conversations.id} 渲染成不带表名的 "id"，
  // 在子查询里会误绑到 chat_messages.id，所以外层列必须显式带表名限定。
  const convId = sql`"conversations"."id"`
  const convLastRead = sql`"conversations"."last_read_seq"`
  return db
    .select({
      ...getTableColumns(conversations),
      last_content: sql<
        string | null
      >`(select content from ${chat_messages} m where m.conversation_id = ${convId} order by m.seq desc limit 1)`,
      last_role: sql<
        string | null
      >`(select role from ${chat_messages} m where m.conversation_id = ${convId} order by m.seq desc limit 1)`,
      last_kind: sql<
        string | null
      >`(select kind from ${chat_messages} m where m.conversation_id = ${convId} order by m.seq desc limit 1)`,
      last_created_at: sql<
        number | null
      >`(select created_at from ${chat_messages} m where m.conversation_id = ${convId} order by m.seq desc limit 1)`,
      unread_count: sql<number>`(select count(*) from ${chat_messages} m where m.conversation_id = ${convId} and m.role = 'assistant' and m.seq > ${convLastRead})`,
    })
    .from(conversations)
    .where(ownerFilter(owner))
    .orderBy(desc(conversations.updated_at))
}

/** 所有按 ID 的查询都同时校验归属，防止跨用户访问 */
export async function findConversation(db: DB, owner: Owner, id: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), ownerFilter(owner)))
  return row ?? null
}

/** 复用逻辑：owner 与某角色最近一条会话（按 updated_at）。 */
export async function findLatestConversationByCharacter(
  db: DB,
  owner: Owner,
  characterId: string,
) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(ownerFilter(owner), eq(conversations.character_id, characterId)))
    .orderBy(desc(conversations.updated_at))
    .limit(1)
  return row ?? null
}

export async function deleteConversation(db: DB, owner: Owner, id: string) {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), ownerFilter(owner)))
    .returning()
  return rows.length > 0
}

/** touchConversation 的 update query（不立即执行，供 batch 组装）。 */
export function touchConversationQuery(db: DB, id: string, title?: string) {
  return db
    .update(conversations)
    .set({ updated_at: new Date(), ...(title ? { title } : {}) })
    .where(eq(conversations.id, id))
}

export async function touchConversation(db: DB, id: string, title?: string) {
  await touchConversationQuery(db, id, title)
}

/**
 * 已读游标推进到会话当前最大 seq，返回新的 last_read_seq。
 */
export async function markConversationRead(db: DB, id: string): Promise<number> {
  await db
    .update(conversations)
    .set({
      last_read_seq: sql`coalesce((select max(${chat_messages.seq}) from ${chat_messages} where ${chat_messages.conversation_id} = ${id}), 0)`,
    })
    .where(eq(conversations.id, id))
  const [row] = await db
    .select({ last_read_seq: conversations.last_read_seq })
    .from(conversations)
    .where(eq(conversations.id, id))
  return row?.last_read_seq ?? 0
}

// ─── 消息 ──────────────────────────────────────

/** 会话消息按 seq 升序（seq 是唯一顺序真相，时间戳仅展示）。 */
export async function findMessages(db: DB, conversationId: string) {
  return db
    .select()
    .from(chat_messages)
    .where(eq(chat_messages.conversation_id, conversationId))
    .orderBy(asc(chat_messages.seq))
}

/** 幂等：按 (conversation_id, client_msg_id) 找已存在的用户消息。 */
export async function findMessageByClientId(
  db: DB,
  conversationId: string,
  clientMsgId: string,
) {
  const [row] = await db
    .select()
    .from(chat_messages)
    .where(
      and(
        eq(chat_messages.conversation_id, conversationId),
        eq(chat_messages.client_msg_id, clientMsgId),
      ),
    )
  return row ?? null
}

/**
 * 某条用户消息之后、下一条用户消息之前的 assistant 回复气泡（一轮的回复）。
 */
export async function findTurnReplies(db: DB, conversationId: string, userSeq: number) {
  const rows = await db
    .select()
    .from(chat_messages)
    .where(and(eq(chat_messages.conversation_id, conversationId), gt(chat_messages.seq, userSeq)))
    .orderBy(asc(chat_messages.seq))
  const replies: ChatMessage[] = []
  for (const r of rows) {
    if (r.role === 'user') break
    replies.push(r)
  }
  return replies
}

/** 单条消息插入 query（不立即执行，供 batch 组装）。seq 缺省用内联子查询。 */
export function messageInsertQuery(
  db: DB,
  params: {
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    seq?: number
    senderCharacterId?: string | null
    clientMsgId?: string | null
  },
) {
  return db
    .insert(chat_messages)
    .values({
      id: crypto.randomUUID(),
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      seq: params.seq ?? nextSeqExpr(params.conversationId),
      sender_character_id: params.senderCharacterId ?? null,
      client_msg_id: params.clientMsgId ?? null,
    })
    .returning()
}

export async function insertMessage(
  db: DB,
  data: {
    conversation_id: string
    role: 'user' | 'assistant'
    content: string
    seq?: number
    sender_character_id?: string | null
    client_msg_id?: string | null
  },
) {
  const [row] = await messageInsertQuery(db, {
    conversationId: data.conversation_id,
    role: data.role,
    content: data.content,
    seq: data.seq,
    senderCharacterId: data.sender_character_id,
    clientMsgId: data.client_msg_id,
  })
  return row
}

/** 会话成员插入 query（DM 也写一行，群聊零改动就位）。 */
export function memberInsertQuery(db: DB, conversationId: string, characterId: string) {
  return db
    .insert(conversation_characters)
    .values({ conversation_id: conversationId, character_id: characterId })
}
