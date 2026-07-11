import { Hono } from 'hono'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ok, fail } from '../../util/response'
import { createRateLimiter } from '../../lib/rateLimit'
import { getAnthropicClient, getChatModel } from '../../lib/anthropic'
import logger from '../../util/logger'
import { getCharacter, toPublicCharacter } from '../characters/data'
import { findConversations, findConversation, findMessages, deleteConversation, type Owner } from './repo'
import { createConversationWithGreeting, streamReply } from './service'

const chatRoutes = new Hono<HonoEnv>()

// 游客严、注册用户松（滑动窗口 1 小时）
const guestLimiter = createRateLimiter(15)
const userLimiter = createRateLimiter(60)

const getOwner = (c: Context<HonoEnv>): Owner => {
  const user = c.get('user')
  return user ? { userId: user.userId } : { guestId: c.get('guestId') }
}

const createConversationSchema = z.object({ characterId: z.string().min(1) })
const sendMessageSchema = z.object({ content: z.string().min(1).max(2000) })

// 新建会话（带角色开场白）
chatRoutes.post('/conversations', async (c) => {
  const parsed = createConversationSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 'INVALID_BODY', parsed.error.message, 400)

  const character = getCharacter(parsed.data.characterId)
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)

  const { conversation, messages } = await createConversationWithGreeting(
    c.get('db'),
    getOwner(c),
    character,
  )
  return ok(c, { conversation, messages, character: toPublicCharacter(character) }, 201)
})

// 我的会话列表
chatRoutes.get('/conversations', async (c) => {
  const rows = await findConversations(c.get('db'), getOwner(c))
  const data = rows.map((row) => {
    const character = getCharacter(row.character_id)
    return { ...row, character: character ? toPublicCharacter(character) : null }
  })
  return ok(c, data)
})

// 会话详情 + 消息
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

// 发消息 → SSE 流式回复
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

  const priorMessages = await findMessages(db, conversation.id)
  const isFirstUserMessage = !priorMessages.some((m) => m.role === 'user')

  let reply
  try {
    reply = await streamReply({
      db,
      anthropic: getAnthropicClient(c),
      model: getChatModel(c),
      character,
      conversationId: conversation.id,
      userContent: parsed.data.content,
      isFirstUserMessage,
    })
  } catch (err) {
    logger.error('chat stream setup failed', { error: String(err) })
    return fail(c, 'CHAT_UNAVAILABLE', 'Chat service unavailable', 503)
  }

  const { stream, finalize } = reply

  return streamSSE(c, async (sse) => {
    let accumulated = ''
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          accumulated += event.delta.text
          await sse.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.delta.text }) })
        }
      }
      await finalize(accumulated)
      await sse.writeSSE({ event: 'done', data: JSON.stringify({ conversationId: conversation.id }) })
    } catch (err) {
      logger.error('chat stream failed', { error: String(err) })
      // 已经流出去的部分照样落库，用户刷新后不丢
      await finalize(accumulated).catch(() => {})
      await sse.writeSSE({ event: 'error', data: JSON.stringify({ message: '回复中断了，请重试' }) })
    }
  })
})

export { chatRoutes }
