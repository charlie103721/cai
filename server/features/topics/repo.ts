import { eq, and, desc } from 'drizzle-orm'
import type { DB } from '../../db'
import { daily_topics } from '../../db/schema'

/** UTC YYYY-MM-DD */
export const todayKey = () => new Date().toISOString().slice(0, 10)

export async function findActiveTopicsByDate(db: DB, topicDate: string) {
  return db
    .select()
    .from(daily_topics)
    .where(and(eq(daily_topics.topic_date, topicDate), eq(daily_topics.is_active, true)))
    .orderBy(desc(daily_topics.created_at))
}

/** 按 id 查话题（不筛 is_active）；调用方自行判断是否可用。 */
export async function findTopicById(db: DB, id: string) {
  const [row] = await db.select().from(daily_topics).where(eq(daily_topics.id, id))
  return row ?? null
}

export async function insertTopic(
  db: DB,
  data: { topic_date: string; title: string; content: string },
) {
  const [row] = await db
    .insert(daily_topics)
    .values({ id: crypto.randomUUID(), ...data })
    .returning()
  return row
}

export async function deactivateTopic(db: DB, id: string) {
  const [row] = await db
    .update(daily_topics)
    .set({ is_active: false })
    .where(eq(daily_topics.id, id))
    .returning()
  return row ?? null
}
