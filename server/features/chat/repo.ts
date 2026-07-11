import { eq, and, desc, asc } from 'drizzle-orm'
import type { DB } from '../../db'
import { conversations, chat_messages } from '../../db/schema'
import { ownerFilter as sharedOwnerFilter, ownerColumns, type Owner } from '../shared/owner'

// 归属逻辑已抽到 shared/owner，这里保留同名类型/薄封装以兼容既有调用。
export type { Owner }

const ownerFilter = (owner: Owner) => sharedOwnerFilter(conversations, owner)

export async function insertConversation(db: DB, owner: Owner, characterId: string) {
  const [row] = await db
    .insert(conversations)
    .values({
      id: crypto.randomUUID(),
      ...ownerColumns(owner),
      character_id: characterId,
    })
    .returning()
  return row
}

export async function findConversations(db: DB, owner: Owner) {
  return db
    .select()
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

export async function deleteConversation(db: DB, owner: Owner, id: string) {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), ownerFilter(owner)))
    .returning()
  return rows.length > 0
}

export async function touchConversation(db: DB, id: string, title?: string) {
  await db
    .update(conversations)
    .set({ updated_at: new Date(), ...(title ? { title } : {}) })
    .where(eq(conversations.id, id))
}

export async function findMessages(db: DB, conversationId: string) {
  return db
    .select()
    .from(chat_messages)
    .where(eq(chat_messages.conversation_id, conversationId))
    .orderBy(asc(chat_messages.created_at))
}

export async function insertMessage(
  db: DB,
  data: { conversation_id: string; role: 'user' | 'assistant'; content: string },
) {
  const [row] = await db
    .insert(chat_messages)
    .values({ id: crypto.randomUUID(), ...data })
    .returning()
  return row
}
