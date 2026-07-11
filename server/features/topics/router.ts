import { Hono } from 'hono'
import { z } from 'zod'
import { ok, fail } from '../../util/response'
import { requireRole } from '../../middleware/requireRole'
import { findActiveTopicsByDate, insertTopic, deactivateTopic, todayKey } from './repo'

const topicRoutes = new Hono<HonoEnv>()

// 公开：今日话题（首页展示 + 注入角色上下文的同一数据源）
topicRoutes.get('/today', async (c) => {
  const topics = await findActiveTopicsByDate(c.get('db'), todayKey())
  return ok(
    c,
    topics.map(({ id, title, content, topic_date }) => ({ id, title, content, topic_date })),
  )
})

const createTopicSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
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

  const { title, content, topic_date } = parsed.data
  const row = await insertTopic(c.get('db'), {
    topic_date: topic_date ?? todayKey(),
    title,
    content,
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
