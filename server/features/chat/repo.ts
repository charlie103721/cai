import { eq, and, desc, asc, isNull } from 'drizzle-orm'
import type { DB } from '../../db'
import { conversations, chat_messages } from '../../db/schema'

/** 会话归属：登录用户按 user_id，游客按 guest_id（两者互斥） */
export type Owner = { userId: string } | { guestId: string }

const ownerFilter = (owner: Owner) =>
  'userId' in owner
    ? eq(conversations.user_id, owner.userId)
    : and(eq(conversations.guest_id, owner.guestId), isNull(conversations.user_id))

export async function insertConversation(db: DB, owner: Owner, characterId: string) {
  const [row] = await db
    .insert(conversations)
    .values({
      id: crypto.randomUUID(),
      user_id: 'userId' in owner ? owner.userId : null,
      guest_id: 'guestId' in owner ? owner.guestId : null,
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
