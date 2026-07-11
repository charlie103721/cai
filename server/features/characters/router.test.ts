import { describe, test, expect } from 'vitest'
import { Hono } from 'hono'
import { createMigratedDb } from '../../testutils/db'
import type { DB } from '../../db'
import { characterRoutes } from './router'
import { favoriteRoutes } from '../favorites/router'

/**
 * Minimal harness: inject the migrated test db + a guest identity into context,
 * then mount the real routers. Exercises the HTTP surface (status codes, the
 * ok()/fail() envelope) without the full middleware stack.
 */
function makeApp(db: DB, guestId = 'g1') {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('guestId', guestId)
    c.set('requestId', 'test-req')
    await next()
  })
  app.route('/api/characters', characterRoutes)
  app.route('/api/favorites', favoriteRoutes)
  return app
}

async function body(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string } }
}

describe('GET /api/characters', () => {
  test('returns the enriched roster without persona', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db).request('/api/characters')
    expect(res.status).toBe(200)
    const { data } = await body(res)
    const list = data as Array<Record<string, unknown>>
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]).toHaveProperty('like_count')
    expect(list[0]).toHaveProperty('chat_count')
    expect(list[0]).not.toHaveProperty('persona')
  })
})

describe('GET /api/characters/:id', () => {
  test('404 for unknown id', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db).request('/api/characters/nope')
    expect(res.status).toBe(404)
    expect((await body(res)).error?.code).toBe('CHARACTER_NOT_FOUND')
  })
})

describe('POST /api/characters/:id/like', () => {
  test('toggles like and reports seed-inclusive count', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)

    const on = await app.request('/api/characters/prophet/like', { method: 'POST' })
    expect(on.status).toBe(200)
    const onData = (await body(on)).data as { liked: boolean; like_count: number }
    expect(onData.liked).toBe(true)
    expect(onData.like_count).toBe(67000 + 1)

    const off = await app.request('/api/characters/prophet/like', { method: 'POST' })
    const offData = (await body(off)).data as { liked: boolean; like_count: number }
    expect(offData.liked).toBe(false)
    expect(offData.like_count).toBe(67000)
  })

  test('404 for unknown id', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db).request('/api/characters/nope/like', { method: 'POST' })
    expect(res.status).toBe(404)
    expect((await body(res)).error?.code).toBe('CHARACTER_NOT_FOUND')
  })
})

describe('favorites HTTP surface', () => {
  test('POST is 201, GET returns hue-carrying rows, DELETE clears', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)

    const post = await app.request('/api/favorites/prophet', { method: 'POST' })
    expect(post.status).toBe(201)
    expect((await body(post)).data).toEqual({ favorited: true })

    const get = await app.request('/api/favorites')
    const rows = (await body(get)).data as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'prophet', hue: 265 })
    expect(rows[0]).not.toHaveProperty('like_count')
    expect(rows[0]).not.toHaveProperty('persona')

    const del = await app.request('/api/favorites/prophet', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect((await body(del)).data).toEqual({ favorited: false })

    const empty = await app.request('/api/favorites')
    expect((await body(empty)).data).toEqual([])
  })

  test('POST 404 for unknown id', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db).request('/api/favorites/nope', { method: 'POST' })
    expect(res.status).toBe(404)
    expect((await body(res)).error?.code).toBe('CHARACTER_NOT_FOUND')
  })

  test('favorited flag is reflected in the enriched list for the same owner', async () => {
    const { db } = createMigratedDb()
    const app = makeApp(db)
    await app.request('/api/favorites/rival-mouth', { method: 'POST' })

    const res = await app.request('/api/characters')
    const list = (await body(res)).data as Array<{ id: string; favorited: boolean }>
    expect(list.find((c) => c.id === 'rival-mouth')!.favorited).toBe(true)
    expect(list.find((c) => c.id === 'prophet')!.favorited).toBe(false)
  })
})
