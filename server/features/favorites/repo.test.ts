import { describe, test, expect } from 'vitest'
import { createMigratedDb, seedUser } from '../../testutils/db'
import { type Owner } from '../shared/owner'
import { addFavorite, removeFavorite, findFavoritedCharacterIds, countFavorites } from './repo'

const guest: Owner = { guestId: 'g1' }
const otherGuest: Owner = { guestId: 'g2' }

describe('favorites repo', () => {
  test('POST is idempotent: favoriting twice keeps one row', async () => {
    const { db } = createMigratedDb()
    await addFavorite(db, guest, 'prophet')
    await addFavorite(db, guest, 'prophet')
    expect(await countFavorites(db, guest)).toBe(1)
    expect(await findFavoritedCharacterIds(db, guest)).toEqual(['prophet'])
  })

  test('DELETE is idempotent: removing a non-favorite is a no-op', async () => {
    const { db } = createMigratedDb()
    await removeFavorite(db, guest, 'prophet') // never favorited
    expect(await countFavorites(db, guest)).toBe(0)

    await addFavorite(db, guest, 'prophet')
    await removeFavorite(db, guest, 'prophet')
    await removeFavorite(db, guest, 'prophet') // again, still fine
    expect(await countFavorites(db, guest)).toBe(0)
  })

  test('lists favorited ids newest first', async () => {
    const { db } = createMigratedDb()
    // stagger created_at so ordering is deterministic
    await addFavorite(db, guest, 'prophet')
    await new Promise((r) => setTimeout(r, 1100))
    await addFavorite(db, guest, 'old-coach')
    const ids = await findFavoritedCharacterIds(db, guest)
    expect(ids).toEqual(['old-coach', 'prophet'])
  })

  test('is owner-isolated', async () => {
    const { db, raw } = createMigratedDb()
    seedUser(raw, 'u1')
    const user: Owner = { userId: 'u1' }

    await addFavorite(db, guest, 'prophet')
    await addFavorite(db, otherGuest, 'rival-mouth')
    await addFavorite(db, user, 'sharp-pundit')

    expect(await findFavoritedCharacterIds(db, guest)).toEqual(['prophet'])
    expect(await findFavoritedCharacterIds(db, otherGuest)).toEqual(['rival-mouth'])
    expect(await findFavoritedCharacterIds(db, user)).toEqual(['sharp-pundit'])
    expect(await countFavorites(db, guest)).toBe(1)
  })
})
