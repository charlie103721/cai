import { describe, test, expect } from 'vitest'
import { createMigratedDb, seedUser } from '../../testutils/db'
import { conversations } from '../../db/schema'
import { ownerColumns, type Owner } from '../shared/owner'
import {
  toggleLike,
  countLikes,
  listEnrichedCharacters,
  getEnrichedCharacter,
} from './repo'
import { getCharacter } from './data'

const guest: Owner = { guestId: 'g1' }
const otherGuest: Owner = { guestId: 'g2' }

describe('toggleLike', () => {
  test('toggles on → off → on and reports liked accordingly', async () => {
    const { db } = createMigratedDb()

    expect(await toggleLike(db, guest, 'prophet')).toEqual({ liked: true })
    expect(await countLikes(db, 'prophet')).toBe(1)

    expect(await toggleLike(db, guest, 'prophet')).toEqual({ liked: false })
    expect(await countLikes(db, 'prophet')).toBe(0)

    expect(await toggleLike(db, guest, 'prophet')).toEqual({ liked: true })
    expect(await countLikes(db, 'prophet')).toBe(1)
  })

  test('is owner-isolated: two owners each hold their own like', async () => {
    const { db } = createMigratedDb()
    await toggleLike(db, guest, 'prophet')
    await toggleLike(db, otherGuest, 'prophet')
    expect(await countLikes(db, 'prophet')).toBe(2)

    // one owner un-liking leaves the other's row intact
    await toggleLike(db, guest, 'prophet')
    expect(await countLikes(db, 'prophet')).toBe(1)
  })
})

describe('listEnrichedCharacters', () => {
  test('never serializes persona', async () => {
    const { db } = createMigratedDb()
    const list = await listEnrichedCharacters(db, guest)
    for (const ch of list) expect('persona' in ch).toBe(false)
  })

  test('like_count includes the per-character seed plus real rows', async () => {
    const { db } = createMigratedDb()
    await toggleLike(db, guest, 'prophet')
    await toggleLike(db, otherGuest, 'prophet')

    const list = await listEnrichedCharacters(db, guest)
    const prophet = list.find((c) => c.id === 'prophet')!
    const seed = getCharacter('prophet')!.seed_likes
    expect(prophet.like_count).toBe(seed + 2)
    // untouched character stays at its seed
    const coach = list.find((c) => c.id === 'old-coach')!
    expect(coach.like_count).toBe(getCharacter('old-coach')!.seed_likes)
  })

  test('chat_count includes the per-character seed plus conversations', async () => {
    const { db } = createMigratedDb()
    await db
      .insert(conversations)
      .values({ id: 'cv1', ...ownerColumns(guest), character_id: 'argentina-uncle' })
    await db
      .insert(conversations)
      .values({ id: 'cv2', ...ownerColumns(otherGuest), character_id: 'argentina-uncle' })

    const list = await listEnrichedCharacters(db, guest)
    const uncle = list.find((c) => c.id === 'argentina-uncle')!
    expect(uncle.chat_count).toBe(getCharacter('argentina-uncle')!.seed_chats + 2)
  })

  test('liked / favorited reflect the calling owner only', async () => {
    const { db } = createMigratedDb()
    await toggleLike(db, guest, 'prophet')

    const mine = await listEnrichedCharacters(db, guest)
    expect(mine.find((c) => c.id === 'prophet')!.liked).toBe(true)
    expect(mine.find((c) => c.id === 'rival-mouth')!.liked).toBe(false)

    // a different owner does not see my like
    const theirs = await listEnrichedCharacters(db, otherGuest)
    expect(theirs.find((c) => c.id === 'prophet')!.liked).toBe(false)
  })

  test('exposes the exact enriched shape', async () => {
    const { db } = createMigratedDb()
    const [first] = await listEnrichedCharacters(db, guest)
    expect(Object.keys(first).sort()).toEqual(
      ['chat_count', 'emoji', 'favorited', 'greeting', 'hue', 'id', 'like_count', 'liked', 'name', 'tagline'].sort(),
    )
  })
})

describe('getEnrichedCharacter', () => {
  test('returns the enriched character for a known id', async () => {
    const { db } = createMigratedDb()
    await toggleLike(db, guest, 'sharp-pundit')
    const ch = await getEnrichedCharacter(db, guest, 'sharp-pundit')
    expect(ch).not.toBeNull()
    expect(ch!.liked).toBe(true)
    expect(ch!.like_count).toBe(getCharacter('sharp-pundit')!.seed_likes + 1)
  })

  test('returns null for an unknown id', async () => {
    const { db } = createMigratedDb()
    expect(await getEnrichedCharacter(db, guest, 'nope')).toBeNull()
  })
})

describe('user-owner enrichment via merged rows', () => {
  test('a user sees their own likes, not a stray guest row', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const user: Owner = { userId: 'u1' }

    await toggleLike(db, user, 'old-coach')
    await toggleLike(db, guest, 'old-coach')

    expect(await countLikes(db, 'old-coach')).toBe(2)
    const list = await listEnrichedCharacters(db, user)
    expect(list.find((c) => c.id === 'old-coach')!.liked).toBe(true)
    expect(list.find((c) => c.id === 'old-coach')!.like_count).toBe(
      getCharacter('old-coach')!.seed_likes + 2,
    )
  })
})
