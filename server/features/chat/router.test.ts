import { describe, test, expect } from 'vitest'
import { Hono } from 'hono'
import { createMigratedDb } from '../../testutils/db'
import type { DB } from '../../db'
import { daily_topics } from '../../db/schema'
import { getCharacter } from '../characters/data'
import type { Owner } from '../shared/owner'
import { chatRoutes } from './router'
import { createConversationWithGreeting, sendMessage } from './service'

const character = getCharacter('argentina-uncle')!

/** 注入 db + 归属身份，挂真实 chat 路由，绕过完整中间件栈。 */
function makeApp(db: DB, identity: { guestId?: string; userId?: string } = { guestId: 'g1' }) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('guestId', identity.guestId ?? 'g1')
    if (identity.userId) {
      c.set('user', {
        userId: identity.userId,
        email: 'u@example.com',
        name: 'u',
        role: 'user',
      } as never)
    }
    c.set('requestId', 'test-req')
    await next()
  })
  app.route('/api/chat', chatRoutes)
  return app
}

async function body(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string } }
}

const postJson = (app: Hono<HonoEnv>, path: string, payload?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

describe('POST /api/chat/conversations', () => {
  test('no topicId: creates then reuses the same conversation', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)

    const first = await postJson(app, '/api/chat/conversations', { characterId: character.id })
    expect(first.status).toBe(201)
    const firstData = (await body(first)).data as { conversation: { id: string }; reused: boolean }
    expect(firstData.reused).toBe(false)

    const second = await postJson(app, '/api/chat/conversations', { characterId: character.id })
    expect(second.status).toBe(200)
    const secondData = (await body(second)).data as {
      conversation: { id: string }
      reused: boolean
    }
    expect(secondData.reused).toBe(true)
    expect(secondData.conversation.id).toBe(firstData.conversation.id)
  })

  test('unknown character → 404', async () => {
    const { db } = createMigratedDb()
    const res = await postJson(makeApp(db), '/api/chat/conversations', { characterId: 'nope' })
    expect(res.status).toBe(404)
    expect((await body(res)).error?.code).toBe('CHARACTER_NOT_FOUND')
  })

  test('with topicId: always creates and stores topic_id', async () => {
    const { db } = createMigratedDb()
    await db
      .insert(daily_topics)
      .values({ id: 't1', topic_date: '2026-07-11', title: 'T', content: 'C' })
    const app = makeApp(db)

    const a = await postJson(app, '/api/chat/conversations', {
      characterId: character.id,
      topicId: 't1',
    })
    expect(a.status).toBe(201)
    const aData = (await body(a)).data as { conversation: { id: string; topic_id: string } }
    expect(aData.conversation.topic_id).toBe('t1')

    // topic-seeded always creates a new one (no reuse)
    const b = await postJson(app, '/api/chat/conversations', {
      characterId: character.id,
      topicId: 't1',
    })
    const bData = (await body(b)).data as { conversation: { id: string } }
    expect(bData.conversation.id).not.toBe(aData.conversation.id)
  })

  test('unknown/inactive topic → 404 TOPIC_NOT_FOUND', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)
    const res = await postJson(app, '/api/chat/conversations', {
      characterId: character.id,
      topicId: 'ghost',
    })
    expect(res.status).toBe(404)
    expect((await body(res)).error?.code).toBe('TOPIC_NOT_FOUND')

    // inactive topic also 404
    await db.insert(daily_topics).values({
      id: 'dead',
      topic_date: '2026-07-11',
      title: 'T',
      content: 'C',
      is_active: false,
    })
    const res2 = await postJson(app, '/api/chat/conversations', {
      characterId: character.id,
      topicId: 'dead',
    })
    expect(res2.status).toBe(404)
  })
})

describe('cross-owner isolation → 404', () => {
  test('another owner cannot read / message / read-cursor / delete', async () => {
    const { db } = createMigratedDb()
    const mine = makeApp(db, { guestId: 'owner' })
    const created = await postJson(mine, '/api/chat/conversations', { characterId: character.id })
    const convId = ((await body(created)).data as { conversation: { id: string } }).conversation.id

    const other = makeApp(db, { guestId: 'intruder' })
    const get = await other.request(`/api/chat/conversations/${convId}`)
    expect(get.status).toBe(404)

    const msg = await postJson(other, `/api/chat/conversations/${convId}/messages`, {
      content: 'hi',
    })
    expect(msg.status).toBe(404)
    expect((await body(msg)).error?.code).toBe('CONVERSATION_NOT_FOUND')

    const read = await postJson(other, `/api/chat/conversations/${convId}/read`)
    expect(read.status).toBe(404)

    const del = await other.request(`/api/chat/conversations/${convId}`, { method: 'DELETE' })
    expect(del.status).toBe(404)
  })
})

describe('POST /api/chat/conversations/:id/messages — validation, idempotency', () => {
  test('invalid body → 400', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)
    const { conversation } = await createConversationWithGreeting(db, { guestId: 'g1' }, character)
    const res = await postJson(app, `/api/chat/conversations/${conversation.id}/messages`, {
      content: '',
    })
    expect(res.status).toBe(400)
  })

  test('clientMsgId replay returns the same rows without calling the LLM', async () => {
    const { db } = createMigratedDb()
    const owner: Owner = { guestId: 'g1' }
    const { conversation } = await createConversationWithGreeting(db, owner, character)
    const clientMsgId = crypto.randomUUID()

    // 先用假 LLM 直接经 service 落一轮
    const seeded = await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      clientMsgId,
      complete: async () => 'a\n---\nb',
    })

    // 再通过路由用同一 clientMsgId 重放：不触 LLM（配置缺失也不会 503）
    const app = makeApp(db, { guestId: 'g1' })
    const res = await postJson(app, `/api/chat/conversations/${conversation.id}/messages`, {
      content: 'hi',
      clientMsgId,
    })
    expect(res.status).toBe(200)
    const data = (await body(res)).data as {
      userMessage: { id: string }
      messages: { id: string; content: string }[]
    }
    expect(data.userMessage.id).toBe(seeded.userMessage.id)
    expect(data.messages.map((m) => m.content)).toEqual(['a', 'b'])
  })

  test('guest rate limit split → GUEST_LIMIT_REACHED after 15', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db, { guestId: 'rl-guest' })
    // 前 15 次消耗窗口（会话不存在 → 404，但限流器已计数）
    for (let i = 0; i < 15; i++) {
      await postJson(app, '/api/chat/conversations/ghost/messages', { content: 'x' })
    }
    const res = await postJson(app, '/api/chat/conversations/ghost/messages', { content: 'x' })
    expect(res.status).toBe(429)
    expect((await body(res)).error?.code).toBe('GUEST_LIMIT_REACHED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})

describe('inbox list + read cursor', () => {
  test('last_message and unread_count reflect the turn; read resets unread', async () => {
    const { db } = createMigratedDb()
    const owner: Owner = { guestId: 'inbox-guest' }
    const { conversation } = await createConversationWithGreeting(db, owner, character)
    await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      complete: async () => 'reply-1\n---\nreply-2',
    })

    const app = makeApp(db, { guestId: 'inbox-guest' })
    const list = await app.request('/api/chat/conversations')
    const rows = (await body(list)).data as Array<{
      id: string
      unread_count: number
      last_message: { role: string; content: string; kind: string; created_at: string } | null
      character: { id: string } | null
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].last_message?.content).toBe('reply-2')
    expect(rows[0].last_message?.role).toBe('assistant')
    expect(rows[0].last_message?.kind).toBe('text')
    // greeting excluded (seq=1=last_read); two new assistant bubbles → 2 unread
    expect(rows[0].unread_count).toBe(2)
    expect(rows[0].character?.id).toBe(character.id)

    const read = await postJson(app, `/api/chat/conversations/${conversation.id}/read`)
    expect(read.status).toBe(200)
    const readData = (await body(read)).data as { last_read_seq: number }
    expect(readData.last_read_seq).toBe(4) // greeting + user + 2 bubbles

    const list2 = await app.request('/api/chat/conversations')
    const rows2 = (await body(list2)).data as Array<{ unread_count: number }>
    expect(rows2[0].unread_count).toBe(0)
  })

  test('empty conversation list for a fresh owner', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db, { guestId: 'nobody' })
    const list = await app.request('/api/chat/conversations')
    expect((await body(list)).data).toEqual([])
  })
})
