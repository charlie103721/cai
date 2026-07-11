import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { ok, fail } from '../../util/response'
import { createRateLimiter } from '../../lib/rateLimit'
import { getLlmConfig, completeChatCompletion } from '../../lib/llm'
import logger from '../../util/logger'
import { getCharacter, toPublicCharacter } from '../characters/data'
import { findTopicById } from '../topics/repo'
import {
  findConversations,
  findConversation,
  findLatestConversationByCharacter,
  findMessages,
  deleteConversation,
  markConversationRead,
  type Owner,
} from './repo'
import { createConversationWithGreeting, sendMessage } from './service'

const chatRoutes = new Hono<HonoEnv>()

const MAX_REPLY_TOKENS = 1024

// 游客严、注册用户松（滑动窗口 1 小时）
const guestLimiter = createRateLimiter(15)
const userLimiter = createRateLimiter(60)

const getOwner = (c: Context<HonoEnv>): Owner => {
  const user = c.get('user')
  return user ? { userId: user.userId } : { guestId: c.get('guestId') }
}

const createConversationSchema = z.object({
  characterId: z.string().min(1),
  topicId: z.string().min(1).optional(),
})
const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  clientMsgId: z.string().uuid().optional(),
})

/**
 * 新建/复用会话。
 * - 无 topicId：复用 owner 与该角色最近一条会话（reused:true），没有则新建。
 * - 有 topicId：始终新建；话题须存在且 active，否则 404 TOPIC_NOT_FOUND。
 */
chatRoutes.post('/conversations', async (c) => {
  const parsed = createConversationSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 'INVALID_BODY', parsed.error.message, 400)

  const character = getCharacter(parsed.data.characterId)
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)

  const db = c.get('db')
  const owner = getOwner(c)

  if (!parsed.data.topicId) {
    const existing = await findLatestConversationByCharacter(db, owner, character.id)
    if (existing) {
      const messages = await findMessages(db, existing.id)
      return ok(c, {
        conversation: existing,
        messages,
        character: toPublicCharacter(character),
        reused: true,
      })
    }
    const created = await createConversationWithGreeting(db, owner, character)
    return ok(
      c,
      { ...created, character: toPublicCharacter(character), reused: false },
      201,
    )
  }

  const topic = await findTopicById(db, parsed.data.topicId)
  if (!topic || !topic.is_active) return fail(c, 'TOPIC_NOT_FOUND', 'Topic not found', 404)

  const created = await createConversationWithGreeting(db, owner, character, topic)
  return ok(c, { ...created, character: toPublicCharacter(character), reused: false }, 201)
})

// 收件箱：会话列表 + 最后一条消息 + 未读数
chatRoutes.get('/conversations', async (c) => {
  const rows = await findConversations(c.get('db'), getOwner(c))
  const data = rows.map((row) => {
    const { last_content, last_role, last_kind, last_created_at, unread_count, ...conversation } =
      row
    const character = getCharacter(conversation.character_id)
    return {
      ...conversation,
      character: character ? toPublicCharacter(character) : null,
      last_message:
        last_content == null
          ? null
          : {
              role: last_role,
              content: last_content,
              kind: last_kind,
              // created_at 存的是 epoch 秒，转成 Date 让 ok() 统一序列化成 ISO
              created_at: last_created_at == null ? null : new Date(last_created_at * 1000),
            },
      unread_count,
    }
  })
  return ok(c, data)
})

// 会话详情 + 消息（按 seq 升序）
chatRoutes.get('/conversations/:id', async (c) => {
  const db = c.get('db')
  const conversation = await findConversation(db, getOwner(c), c.req.param('id'))
  if (!conversation) return fail(c, 'CONVERSATION_NOT_FOUND', 'Conversation not found', 404)

  const character = getCharacter(conversation.character_id)
  const messages = await findMessages(db, conversation.id)
  return ok(c, {
    conversation,
    messages,
    character: character ? toPublicCharacter(character) : null,
  })
})

chatRoutes.delete('/conversations/:id', async (c) => {
  const deleted = await deleteConversation(c.get('db'), getOwner(c), c.req.param('id'))
  if (!deleted) return fail(c, 'CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  return ok(c, { deleted: true })
})

// 标记已读：已读游标推进到当前最大 seq
chatRoutes.post('/conversations/:id/read', async (c) => {
  const db = c.get('db')
  const conversation = await findConversation(db, getOwner(c), c.req.param('id'))
  if (!conversation) return fail(c, 'CONVERSATION_NOT_FOUND', 'Conversation not found', 404)

  const last_read_seq = await markConversationRead(db, conversation.id)
  return ok(c, { last_read_seq })
})

// 发消息 → 一次落库用户消息 + 助手回复气泡（多气泡）
chatRoutes.post('/conversations/:id/messages', async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 'INVALID_BODY', parsed.error.message, 400)

  const user = c.get('user')
  const limiter = user ? userLimiter : guestLimiter
  const limitKey = user ? `user:${user.userId}` : `guest:${c.get('guestId')}`
  const limit = limiter.check(limitKey)
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSeconds))
    // 游客限流是注册引导的触发点，客户端按 code 区分文案
    return fail(c, user ? 'RATE_LIMITED' : 'GUEST_LIMIT_REACHED', 'Too many messages', 429)
  }

  const db = c.get('db')
  const conversation = await findConversation(db, getOwner(c), c.req.param('id'))
  if (!conversation) return fail(c, 'CONVERSATION_NOT_FOUND', 'Conversation not found', 404)

  const character = getCharacter(conversation.character_id)
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character no longer exists', 410)

  try {
    // complete 延迟解析 LLM 配置：幂等重放不触 LLM，也就不要求配置
    const result = await sendMessage({
      db,
      character,
      conversation,
      content: parsed.data.content,
      clientMsgId: parsed.data.clientMsgId,
      complete: ({ system, messages }) =>
        completeChatCompletion({
          config: getLlmConfig(c),
          system,
          messages,
          maxTokens: MAX_REPLY_TOKENS,
        }),
    })
    return ok(c, { userMessage: result.userMessage, messages: result.messages })
  } catch (err) {
    logger.error('chat sendMessage failed', { error: String(err) })
    // LLM 失败：什么都没落库；客户端保留输入，重试即普通重发
    return fail(c, 'CHAT_UNAVAILABLE', 'Chat service unavailable', 503)
  }
})

export { chatRoutes }
