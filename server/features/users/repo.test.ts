import { describe, test, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createMigratedDb, seedUser } from '../../testutils/db'
import { conversations, character_likes, character_favorites } from '../../db/schema'
import type { Owner } from '../shared/owner'
import { toggleLike } from '../characters/repo'
import { addFavorite } from '../favorites/repo'
import {
  getProfile,
  updateProfile,
  getStats,
  mergeGuest,
  HandleTakenError,
} from './repo'

describe('profile repo', () => {
  test('getProfile returns the public shape (never role)', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const profile = await getProfile(db, 'u1')
    expect(profile).toEqual({ name: 'u1', handle: null, favorite_team: null, image: null })
  })

  test('updateProfile writes only the given fields and returns them', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')

    const afterHandle = await updateProfile(db, 'u1', { handle: 'ronaldo' })
    expect(afterHandle.handle).toBe('ronaldo')
    expect(afterHandle.favorite_team).toBeNull()

    const afterTeam = await updateProfile(db, 'u1', { favorite_team: 'Argentina' })
    expect(afterTeam.handle).toBe('ronaldo') // untouched
    expect(afterTeam.favorite_team).toBe('Argentina')
  })

  test('duplicate handle throws HandleTakenError (caught constraint, no race)', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    seedUser(raw, 'u2')
    await updateProfile(db, 'u1', { handle: 'taken' })
    await expect(updateProfile(db, 'u2', { handle: 'taken' })).rejects.toBeInstanceOf(
      HandleTakenError,
    )
  })
})

describe('stats repo', () => {
  test('counts are owner-scoped (chats, favorites, likes given)', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const user: Owner = { userId: 'u1' }
    const guest: Owner = { guestId: 'g1' }

    await toggleLike(db, user, 'prophet')
    await toggleLike(db, user, 'old-coach')
    await addFavorite(db, user, 'prophet')
    await db.insert(conversations).values({ id: 'c1', user_id: 'u1', character_id: 'prophet' })

    // guest noise must not leak into the user's stats
    await toggleLike(db, guest, 'rival-mouth')
    await addFavorite(db, guest, 'rival-mouth')

    expect(await getStats(db, user)).toEqual({ chats: 1, favorites: 1, likes: 2 })
    expect(await getStats(db, guest)).toEqual({ chats: 0, favorites: 1, likes: 1 })
  })
})

describe('guest → account merge', () => {
  test('moves rows, resolves collisions, and is idempotent', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const user: Owner = { userId: 'u1' }
    const guest: Owner = { guestId: 'g1' }

    // User already likes prophet — capture the row id to prove it survives.
    await toggleLike(db, user, 'prophet')
    const [userProphetLike] = await db
      .select({ id: character_likes.id })
      .from(character_likes)
      .where(and(eq(character_likes.user_id, 'u1'), eq(character_likes.character_id, 'prophet')))

    // Guest engagement: prophet (collides), old-coach (unique), a favorite, a chat.
    await toggleLike(db, guest, 'prophet')
    await toggleLike(db, guest, 'old-coach')
    await addFavorite(db, guest, 'prophet')
    await db.insert(conversations).values({ id: 'c1', guest_id: 'g1', character_id: 'prophet' })

    await mergeGuest(db, 'g1', 'u1')

    // Likes: user keeps its own prophet row + gains old-coach; guest dup dropped.
    const userLikes = await db
      .select({ id: character_likes.id, character_id: character_likes.character_id })
      .from(character_likes)
      .where(eq(character_likes.user_id, 'u1'))
    expect(userLikes.map((r) => r.character_id).sort()).toEqual(['old-coach', 'prophet'])
    // The surviving prophet like is the user's original row, not the guest's.
    expect(userLikes.find((r) => r.character_id === 'prophet')!.id).toBe(userProphetLike.id)

    // No guest rows remain anywhere.
    expect(
      (await db.select().from(character_likes).where(eq(character_likes.guest_id, 'g1'))).length,
    ).toBe(0)
    expect(
      (await db.select().from(character_favorites).where(eq(character_favorites.guest_id, 'g1')))
        .length,
    ).toBe(0)
    expect(
      (await db.select().from(conversations).where(eq(conversations.guest_id, 'g1'))).length,
    ).toBe(0)

    // Favorites + conversation moved onto the account.
    expect(await getStats(db, user)).toEqual({ chats: 1, favorites: 1, likes: 2 })
    // The guest sees nothing now (merged rows carry user_id, guest_id NULL).
    expect(await getStats(db, guest)).toEqual({ chats: 0, favorites: 0, likes: 0 })

    // Second run is a no-op (zero rows matched, no error).
    await mergeGuest(db, 'g1', 'u1')
    expect(await getStats(db, user)).toEqual({ chats: 1, favorites: 1, likes: 2 })
  })
})
