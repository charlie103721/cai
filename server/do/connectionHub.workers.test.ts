import { describe, test, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { DB } from '../db'
import { chat_messages, conversations } from '../db/schema'
import { getCharacter } from '../features/characters/data'
import { createConversationWithGreeting, sendMessage } from '../features/chat/service'
import type { Owner } from '../features/chat/repo'

/**
 * ConnectionHub 协议测试，跑在真实 workerd 里（miniflare 本地 D1 + DO）。
 *
 * 关键手法：用 F3 的幂等重放通路给 DO 喂数据 —— 先用注入的假 LLM 落一轮
 * （带 clientMsgId），再让 DO 收一个同 clientMsgId 的 send_message 帧。这样能
 * 完整驱动 ack→typing→message→typing 的节奏与顺序，全程不调 LLM、不触网。
 * 新鲜 send_message（无 key）走 LLM 失败通路 → CHAT_UNAVAILABLE。
 */

const character = getCharacter('argentina-uncle')!

type Frame = { type: string; [k: string]: unknown }

const db = (): DB => drizzle(env.DB, { schema }) as unknown as DB

/** 每个用例用独立 owner，避免 DO 限流计数 / 数据跨用例污染。 */
function freshOwner(): { owner: Owner; ownerKey: string } {
  const id = crypto.randomUUID()
  return { owner: { guestId: id }, ownerKey: `guest:${id}` }
}

async function connect(ownerKey: string) {
  const stub = env.CONNECTION_HUB.get(env.CONNECTION_HUB.idFromName(ownerKey))
  const res = await stub.fetch('https://connection-hub/connect', {
    headers: { Upgrade: 'websocket', 'X-Owner-Key': ownerKey },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('no webSocket on upgrade response')
  ws.accept()
  const frames: Frame[] = []
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(e.data as string) as Frame)
  })
  return { ws, frames }
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** 用假 LLM 落一轮完整对话，返回会话与该轮的 clientMsgId。 */
async function seedTurn(owner: Owner, reply: string) {
  const database = db()
  const { conversation } = await createConversationWithGreeting(database, owner, character)
  const clientMsgId = crypto.randomUUID()
  const turn = await sendMessage({
    db: database,
    character,
    conversation,
    content: 'hi',
    clientMsgId,
    complete: async () => reply,
  })
  return { conversation, clientMsgId, turn }
}

describe('ConnectionHub protocol', () => {
  test('ping → pong', async () => {
    const { ownerKey } = freshOwner()
    const { ws, frames } = await connect(ownerKey)
    ws.send(JSON.stringify({ type: 'ping' }))
    await waitFor(() => frames.some((f) => f.type === 'pong'))
    expect(frames.map((f) => f.type)).toContain('pong')
  })

  test('send_message → ack, typing on, message(s), typing off (in order)', async () => {
    const { owner, ownerKey } = freshOwner()
    const { conversation, clientMsgId } = await seedTurn(owner, 'A\n---\nB')

    const { ws, frames } = await connect(ownerKey)
    ws.send(JSON.stringify({ type: 'send_message', clientMsgId, conversationId: conversation.id, content: 'hi' }))

    await waitFor(() => frames.some((f) => f.type === 'typing' && f.on === false))

    const types = frames.map((f) => f.type)
    expect(types).toEqual(['ack', 'typing', 'message', 'message', 'typing'])

    const ack = frames[0] as unknown as { userMessage: { content: string; role: string } }
    expect(ack.userMessage.role).toBe('user')
    expect(ack.userMessage.content).toBe('hi')
    expect((frames[1] as unknown as { on: boolean }).on).toBe(true)
    expect((frames[2] as unknown as { message: { content: string } }).message.content).toBe('A')
    expect((frames[3] as unknown as { message: { content: string } }).message.content).toBe('B')
    expect((frames[4] as unknown as { on: boolean }).on).toBe(false)
  })

  test('idempotent resend returns the same rows, no duplicate persistence', async () => {
    const { owner, ownerKey } = freshOwner()
    const { conversation, clientMsgId } = await seedTurn(owner, 'once')

    const { ws, frames } = await connect(ownerKey)
    const frame = JSON.stringify({ type: 'send_message', clientMsgId, conversationId: conversation.id, content: 'hi' })

    ws.send(frame)
    await waitFor(() => frames.filter((f) => f.type === 'typing' && f.on === false).length === 1)
    ws.send(frame)
    await waitFor(() => frames.filter((f) => f.type === 'typing' && f.on === false).length === 2)

    const acks = frames.filter((f) => f.type === 'ack') as unknown as { userMessage: { id: string } }[]
    const messages = frames.filter((f) => f.type === 'message') as unknown as { message: { id: string } }[]
    expect(acks).toHaveLength(2)
    expect(acks[0].userMessage.id).toBe(acks[1].userMessage.id)
    expect(messages).toHaveLength(2)
    expect(messages[0].message.id).toBe(messages[1].message.id)

    // 库里没有重复：开场白 + 用户消息 + 1 条回复 = 3。
    const rows = await db().select().from(chat_messages).where(eq(chat_messages.conversation_id, conversation.id))
    expect(rows).toHaveLength(3)
  })

  test('rate limit: guest 16th send → GUEST_LIMIT_REACHED error frame', async () => {
    const { owner, ownerKey } = freshOwner()
    const { conversation, clientMsgId } = await seedTurn(owner, 'ok')

    const { ws, frames } = await connect(ownerKey)
    const frame = JSON.stringify({ type: 'send_message', clientMsgId, conversationId: conversation.id, content: 'hi' })
    for (let i = 0; i < 16; i++) ws.send(frame)

    await waitFor(() =>
      frames.some((f) => f.type === 'error' && f.code === 'GUEST_LIMIT_REACHED'),
    )

    const acks = frames.filter((f) => f.type === 'ack')
    const errors = frames.filter((f) => f.type === 'error') as unknown as { code: string }[]
    expect(acks).toHaveLength(15)
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('GUEST_LIMIT_REACHED')
  })

  test('send_message for an unknown conversation → CONVERSATION_NOT_FOUND', async () => {
    const { ownerKey } = freshOwner()
    const { ws, frames } = await connect(ownerKey)
    ws.send(
      JSON.stringify({
        type: 'send_message',
        clientMsgId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        content: 'hi',
      }),
    )
    await waitFor(() => frames.some((f) => f.type === 'error'))
    expect((frames.find((f) => f.type === 'error') as unknown as { code: string }).code).toBe(
      'CONVERSATION_NOT_FOUND',
    )
  })

  test('fresh send_message with no LLM key → CHAT_UNAVAILABLE, nothing persisted', async () => {
    const { owner, ownerKey } = freshOwner()
    const database = db()
    const { conversation } = await createConversationWithGreeting(database, owner, character)

    const { ws, frames } = await connect(ownerKey)
    ws.send(
      JSON.stringify({
        type: 'send_message',
        clientMsgId: crypto.randomUUID(),
        conversationId: conversation.id,
        content: 'hi',
      }),
    )
    await waitFor(() => frames.some((f) => f.type === 'error'))
    expect((frames.find((f) => f.type === 'error') as unknown as { code: string }).code).toBe('CHAT_UNAVAILABLE')

    // F3 语义：LLM 失败什么都不落库，只剩开场白。
    const rows = await db().select().from(chat_messages).where(eq(chat_messages.conversation_id, conversation.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('assistant')
  })

  test('mark_read advances last_read_seq', async () => {
    const { owner, ownerKey } = freshOwner()
    const { conversation } = await seedTurn(owner, 'A\n---\nB') // greeting + user + 2 bubbles → max seq 4

    const { ws } = await connect(ownerKey)
    ws.send(JSON.stringify({ type: 'mark_read', conversationId: conversation.id }))

    const readSeq = async () => {
      const [row] = await db()
        .select({ seq: conversations.last_read_seq })
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
      return row?.seq ?? 0
    }
    // 开场白 last_read_seq=1；mark_read 后应推进到当前最大 seq=4。
    await waitFor(async () => (await readSeq()) === 4)
    expect(await readSeq()).toBe(4)
  })

  test('malformed frame → INVALID_FRAME error', async () => {
    const { ownerKey } = freshOwner()
    const { ws, frames } = await connect(ownerKey)
    ws.send('not json at all')
    await waitFor(() => frames.some((f) => f.type === 'error'))
    expect((frames.find((f) => f.type === 'error') as unknown as { code: string }).code).toBe('INVALID_FRAME')
  })
})
