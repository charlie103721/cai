import { describe, test, expect } from 'vitest'
import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { createMigratedDb } from '../../testutils/db'
import type { DB } from '../../db'
import { topicRoutes } from './router'
import { todayKey } from './repo'
import type { UserRole } from '../users/roles'

/**
 * Mount the real topic router with an injected db + identity. `role` seeds the
 * JWT user claim `requireRole` reads (admin for the create/delete endpoints).
 */
function makeApp(db: DB, user: { role: UserRole } | null = null) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('guestId', 'g1')
    c.set('requestId', 'test-req')
    if (user)
      c.set('user', {
        userId: 'u1',
        email: 'a@b.c',
        name: 'a',
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    await next()
  })
  app.route('/api/topics', topicRoutes)
  return app
}

async function body(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string } }
}

const admin = { role: 'admin' as const }

function validTopic(over: Record<string, unknown> = {}) {
  return {
    title: '阿根廷 vs 巴西',
    content: '南美德比今晚开踢',
    headline: '世纪对决今夜上演',
    heat: 12000,
    tags: ['世界杯', '南美德比'],
    character_ids: ['argentina-uncle', 'rival-mouth'],
    hue: 220,
    pinned: false,
    ...over,
  }
}

/** Insert a daily_topics row directly (bypasses the router / Zod) for cases
 * that need controlled created_at or deliberately malformed JSON columns. */
function insertRaw(
  raw: Database.Database,
  o: {
    id: string
    title?: string
    tags?: string
    character_ids?: string
    pinned?: number
    created_at: number
    topic_date?: string
  },
) {
  raw
    .prepare(
      `INSERT INTO daily_topics
        (id, topic_date, title, content, is_active, headline, heat, tags, character_ids, hue, pinned, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.id,
      o.topic_date ?? todayKey(),
      o.title ?? o.id,
      'content',
      1,
      'headline',
      0,
      o.tags ?? '[]',
      o.character_ids ?? '[]',
      28,
      o.pinned ?? 0,
      o.created_at,
    )
}

describe('POST /api/topics (admin)', () => {
  test('create roundtrip: persisted and expanded on /today', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db, admin)

    const post = await app.request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTopic()),
    })
    expect(post.status).toBe(201)

    const get = await app.request('/api/topics/today')
    expect(get.status).toBe(200)
    const rows = (await body(get)).data as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: '阿根廷 vs 巴西',
      headline: '世纪对决今夜上演',
      heat: 12000,
      hue: 220,
      pinned: false,
      tags: ['世界杯', '南美德比'],
    })
    // participants expanded from character_ids via the in-memory roster
    expect(rows[0].participants).toEqual([
      { id: 'argentina-uncle', name: '阿根廷大爷', emoji: '🇦🇷' },
      { id: 'rival-mouth', name: '嘴臭对家', emoji: '😤' },
    ])
    // persona is never leaked through participants
    expect(JSON.stringify(rows[0])).not.toContain('persona')
  })

  test('rejects unknown character with 400 UNKNOWN_CHARACTER', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db, admin).request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTopic({ character_ids: ['argentina-uncle', 'nope'] })),
    })
    expect(res.status).toBe(400)
    expect((await body(res)).error?.code).toBe('UNKNOWN_CHARACTER')
  })

  test('requires admin role', async () => {
    const { db } = createMigratedDb()
    const guest = await makeApp(db).request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTopic()),
    })
    expect(guest.status).toBe(401)

    const plain = await makeApp(db, { role: 'user' as const }).request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTopic()),
    })
    expect(plain.status).toBe(403)
  })

  test('rejects invalid body (tags too many / heat negative)', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db, admin).request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTopic({ heat: -1 })),
    })
    expect(res.status).toBe(400)
    expect((await body(res)).error?.code).toBe('INVALID_BODY')
  })
})

describe('GET /api/topics/today', () => {
  test('sorts pinned first, then created_at desc', async () => {
    const { db, raw } = createMigratedDb()
    insertRaw(raw, { id: 'old', created_at: 100, pinned: 0 })
    insertRaw(raw, { id: 'new', created_at: 200, pinned: 0 })
    insertRaw(raw, { id: 'pinned-old', created_at: 50, pinned: 1 })

    const res = await makeApp(db).request('/api/topics/today')
    const rows = (await body(res)).data as Array<{ id: string }>
    expect(rows.map((r) => r.id)).toEqual(['pinned-old', 'new', 'old'])
  })

  test('malformed JSON columns degrade to [] instead of 500', async () => {
    const { db, raw } = createMigratedDb()
    insertRaw(raw, {
      id: 'bad',
      created_at: 100,
      tags: 'not json at all',
      character_ids: '{oops',
    })

    const res = await makeApp(db).request('/api/topics/today')
    expect(res.status).toBe(200)
    const rows = (await body(res)).data as Array<{ tags: unknown; participants: unknown }>
    expect(rows).toHaveLength(1)
    expect(rows[0].tags).toEqual([])
    expect(rows[0].participants).toEqual([])
  })

  test('skips unknown character ids gracefully', async () => {
    const { db, raw } = createMigratedDb()
    insertRaw(raw, {
      id: 't',
      created_at: 100,
      character_ids: JSON.stringify(['prophet', 'ghost', 'old-coach']),
    })

    const res = await makeApp(db).request('/api/topics/today')
    const rows = (await body(res)).data as Array<{ participants: Array<{ id: string }> }>
    expect(rows[0].participants.map((p) => p.id)).toEqual(['prophet', 'old-coach'])
  })
})
