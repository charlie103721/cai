import { describe, test, expect } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createMigratedDb, seedUser } from '../../testutils/db'
import type { DB } from '../../db'
import { user as userTable, character_likes } from '../../db/schema'
import { toggleLike } from '../characters/repo'
import { addFavorite } from '../favorites/repo'
import { mergeGuest } from '../../middleware/mergeGuest'
import { ok } from '../../util/response'
import { userRoutes } from './router'

type UserCtx = { userId: string; email: string; name: string; role: string; exp: number }

function makeUser(userId: string): UserCtx {
  return { userId, email: `${userId}@example.com`, name: userId, role: 'user', exp: 0 }
}

/** Harness: inject db + optional user/guest identity, mount the real router. */
function makeApp(db: DB, opts: { user?: UserCtx; guestId?: string } = {}) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('requestId', 'test-req')
    c.set('user', (opts.user ?? null) as never)
    if (opts.guestId) c.set('guestId', opts.guestId)
    await next()
  })
  app.route('/api/me', userRoutes)
  return app
}

async function body(res: Response) {
  return (await res.json()) as { data?: unknown; error?: { code: string } }
}

describe('GET /api/me/profile', () => {
  test('401 without a user (authGuard)', async () => {
    const { db } = createMigratedDb()
    const res = await makeApp(db).request('/api/me/profile')
    expect(res.status).toBe(401)
  })

  test('returns name/handle/favorite_team/image', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const res = await makeApp(db, { user: makeUser('u1') }).request('/api/me/profile')
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({
      name: 'u1',
      handle: null,
      favorite_team: null,
      image: null,
    })
  })
})

describe('PATCH /api/me/profile', () => {
  test('lowercases the handle before validating', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const res = await makeApp(db, { user: makeUser('u1') }).request('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'AbC_12' }),
    })
    expect(res.status).toBe(200)
    expect((await body(res)).data).toMatchObject({ handle: 'abc_12' })
  })

  test('rejects a handle that fails the regex', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const res = await makeApp(db, { user: makeUser('u1') }).request('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'no' }), // too short
    })
    expect(res.status).toBe(400)
    expect((await body(res)).error?.code).toBe('INVALID_BODY')
  })

  test('409 HANDLE_TAKEN on a duplicate handle', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    seedUser(raw, 'u2')
    const app = makeApp(db, { user: makeUser('u1') })
    await app.request('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'taken' }),
    })
    const res = await makeApp(db, { user: makeUser('u2') }).request('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'taken' }),
    })
    expect(res.status).toBe(409)
    expect((await body(res)).error?.code).toBe('HANDLE_TAKEN')
  })

  test('role can never be smuggled in via PATCH', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const res = await makeApp(db, { user: makeUser('u1') }).request('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', handle: 'legit_name' }),
    })
    expect(res.status).toBe(200)
    expect((await body(res)).data).toMatchObject({ handle: 'legit_name' })
    const [row] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, 'u1'))
    expect(row.role).toBe('user') // unchanged
  })
})

describe('GET /api/me/stats', () => {
  test('works for a guest without auth', async () => {
    const { db } = createMigratedDb()
    const guest = { guestId: 'g1' } as const
    await addFavorite(db, guest, 'prophet')
    await toggleLike(db, guest, 'prophet')
    await toggleLike(db, guest, 'old-coach')

    const res = await makeApp(db, { guestId: 'g1' }).request('/api/me/stats')
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({ chats: 0, favorites: 1, likes: 2 })
  })
})

describe('mergeGuest middleware', () => {
  /** Mount the middleware behind an injected user + a request-borne guest cookie. */
  function mergeApp(db: DB, userCtx: UserCtx) {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('db', db)
      c.set('requestId', 'test-req')
      c.set('user', userCtx as never)
      await next()
    })
    app.use('*', mergeGuest)
    app.get('/ping', (c) => ok(c, { ok: true }))
    return app
  }

  test('merges guest rows and clears the cookie', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    await toggleLike(db, { guestId: 'g1' }, 'prophet')

    const res = await mergeApp(db, makeUser('u1')).request('/ping', {
      headers: { Cookie: 'guest_id=g1' },
    })
    expect(res.status).toBe(200)

    // Cookie cleared (Max-Age=0).
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/guest_id=/)
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/)

    // Guest like now belongs to the user.
    const moved = await db
      .select()
      .from(character_likes)
      .where(eq(character_likes.user_id, 'u1'))
    expect(moved).toHaveLength(1)
    expect(
      (await db.select().from(character_likes).where(eq(character_likes.guest_id, 'g1'))).length,
    ).toBe(0)
  })

  test('no cookie → no merge, no clear', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const res = await mergeApp(db, makeUser('u1')).request('/ping')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
