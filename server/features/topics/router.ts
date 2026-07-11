import { Hono } from 'hono'
import { z } from 'zod'
import { ok, fail } from '../../util/response'
import { requireRole } from '../../middleware/requireRole'
import { getCharacter } from '../characters/data'
import { findActiveTopicsByDate, insertTopic, deactivateTopic, todayKey } from './repo'

const topicRoutes = new Hono<HonoEnv>()

/**
 * Defensively parse a JSON-in-text column into a string[]. Malformed or
 * unexpected shapes degrade to [] — a bad row must never 500 the feed.
 */
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

// 公开：今日话题（首页 reels 展示 + 注入角色上下文的同一数据源）
topicRoutes.get('/today', async (c) => {
  const topics = await findActiveTopicsByDate(c.get('db'), todayKey())
  return ok(
    c,
    topics.map((t) => {
      // participants 从 character_ids 经内存角色库展开，跳过未知 id
      const participants = parseStringArray(t.character_ids)
        .map((id) => getCharacter(id))
        .filter((ch) => ch != null)
        .map((ch) => ({ id: ch.id, name: ch.name, emoji: ch.emoji }))
      return {
        id: t.id,
        title: t.title,
        headline: t.headline,
        content: t.content,
        topic_date: t.topic_date,
        heat: t.heat,
        tags: parseStringArray(t.tags),
        hue: t.hue,
        pinned: t.pinned,
        participants,
      }
    }),
  )
})

const createTopicSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
  headline: z.string().max(120),
  heat: z.number().int().min(0),
  tags: z.array(z.string().max(24)).max(8),
  character_ids: z.array(z.string()),
  hue: z.number().int().min(0).max(360),
  pinned: z.boolean(),
  // 默认今天，运营可以提前填未来日期
  topic_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

// 运营：新增话题
topicRoutes.post('/', requireRole('admin'), async (c) => {
  const parsed = createTopicSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 'INVALID_BODY', parsed.error.message, 400)

  const { title, content, headline, heat, tags, character_ids, hue, pinned, topic_date } =
    parsed.data

  // 每个 character_id 必须在角色库中，否则 400 UNKNOWN_CHARACTER
  const unknown = character_ids.find((id) => getCharacter(id) == null)
  if (unknown) return fail(c, 'UNKNOWN_CHARACTER', `Unknown character: ${unknown}`, 400)

  const row = await insertTopic(c.get('db'), {
    topic_date: topic_date ?? todayKey(),
    title,
    content,
    headline,
    heat,
    // JSON-serialize the arrays for the text columns; the feed parses them back.
    tags: JSON.stringify(tags),
    character_ids: JSON.stringify(character_ids),
    hue,
    pinned,
  })
  return ok(c, row, 201)
})

// 运营：下线话题
topicRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const row = await deactivateTopic(c.get('db'), c.req.param('id'))
  if (!row) return fail(c, 'TOPIC_NOT_FOUND', 'Topic not found', 404)
  return ok(c, row)
})

export { topicRoutes }
