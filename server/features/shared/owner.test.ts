import { describe, test, expect } from 'vitest'
import { createMigratedDb, seedUser } from '../../testutils/db'
import { character_likes } from '../../db/schema'
import { ownerFilter, ownerColumns, type Owner } from './owner'
import { insertConversation, findConversations } from '../chat/repo'

describe('ownerColumns', () => {
  test('sets exactly user_id for a user owner', () => {
    expect(ownerColumns({ userId: 'u1' })).toEqual({ user_id: 'u1', guest_id: null })
  })
  test('sets exactly guest_id for a guest owner', () => {
    expect(ownerColumns({ guestId: 'g1' })).toEqual({ user_id: null, guest_id: 'g1' })
  })
})

describe('ownerFilter — user/guest isolation via chat repo', () => {
  test('each owner only sees its own conversations', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const user: Owner = { userId: 'u1' }
    const guest: Owner = { guestId: 'g1' }
    const otherGuest: Owner = { guestId: 'g2' }

    await insertConversation(db, user, 'argentina-uncle')
    await insertConversation(db, guest, 'rival-mouth')
    await insertConversation(db, guest, 'prophet')
    await insertConversation(db, otherGuest, 'old-coach')

    expect((await findConversations(db, user)).map((r) => r.character_id)).toEqual(['argentina-uncle'])
    expect((await findConversations(db, guest)).map((r) => r.character_id).sort()).toEqual([
      'prophet',
      'rival-mouth',
    ])
    expect((await findConversations(db, otherGuest)).map((r) => r.character_id)).toEqual(['old-coach'])
  })

  test('a guest row merged into a user (user_id set) is no longer visible to the guest', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const guest: Owner = { guestId: 'g1' }
    const conv = await insertConversation(db, guest, 'argentina-uncle')

    // Simulate the F5 merge: the guest row now also carries a user_id.
    raw.prepare(`UPDATE conversations SET user_id='u1' WHERE id=?`).run(conv.id)

    // Guest filter requires user_id IS NULL, so the merged row disappears for the guest…
    expect(await findConversations(db, guest)).toEqual([])
    // …and belongs to the user instead.
    expect((await findConversations(db, { userId: 'u1' })).map((r) => r.id)).toEqual([conv.id])
  })

  test('builds a usable filter for any owner-scoped table (character_likes)', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    await db
      .insert(character_likes)
      .values({ id: 'l1', ...ownerColumns({ guestId: 'g1' }), character_id: 'prophet' })
    await db
      .insert(character_likes)
      .values({ id: 'l2', ...ownerColumns({ userId: 'u1' }), character_id: 'prophet' })

    const guestLikes = await db.select().from(character_likes).where(ownerFilter(character_likes, { guestId: 'g1' }))
    expect(guestLikes.map((r) => r.id)).toEqual(['l1'])
    const userLikes = await db.select().from(character_likes).where(ownerFilter(character_likes, { userId: 'u1' }))
    expect(userLikes.map((r) => r.id)).toEqual(['l2'])
  })
})

describe('partial unique indexes on character_likes', () => {
  test('a guest cannot like the same character twice', () => {
    const { raw } = createMigratedDb()
    const now = Math.floor(Date.now() / 1000)
    const ins = raw.prepare(
      `INSERT INTO character_likes (id, user_id, guest_id, character_id, created_at) VALUES (?,?,?,?,?)`,
    )
    ins.run('l1', null, 'g1', 'prophet', now)
    expect(() => ins.run('l2', null, 'g1', 'prophet', now)).toThrow()
  })

  test('different guests may like the same character', () => {
    const { raw } = createMigratedDb()
    const now = Math.floor(Date.now() / 1000)
    const ins = raw.prepare(
      `INSERT INTO character_likes (id, user_id, guest_id, character_id, created_at) VALUES (?,?,?,?,?)`,
    )
    ins.run('l1', null, 'g1', 'prophet', now)
    expect(() => ins.run('l2', null, 'g2', 'prophet', now)).not.toThrow()
  })

  test('a user cannot like the same character twice', () => {
    const { raw } = createMigratedDb()
    const now = Math.floor(Date.now() / 1000)
    // needs a real user row for the FK
    raw
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES ('u1','U','u@e.com',0,'user',?,?)`,
      )
      .run(now, now)
    const ins = raw.prepare(
      `INSERT INTO character_likes (id, user_id, guest_id, character_id, created_at) VALUES (?,?,?,?,?)`,
    )
    ins.run('l1', 'u1', null, 'prophet', now)
    expect(() => ins.run('l2', 'u1', null, 'prophet', now)).toThrow()
  })
})
