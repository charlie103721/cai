import { and, count, desc, eq } from 'drizzle-orm'
import type { DB } from '../../db'
import { character_favorites } from '../../db/schema'
import { ownerColumns, ownerFilter, type Owner } from '../shared/owner'

/** 幂等收藏：已收藏则 ON CONFLICT DO NOTHING，不重复插入。 */
export async function addFavorite(db: DB, owner: Owner, characterId: string): Promise<void> {
  await db
    .insert(character_favorites)
    .values({ id: crypto.randomUUID(), ...ownerColumns(owner), character_id: characterId })
    .onConflictDoNothing()
}

/** 幂等取消收藏：未收藏时删除 0 行也返回成功。 */
export async function removeFavorite(db: DB, owner: Owner, characterId: string): Promise<void> {
  await db
    .delete(character_favorites)
    .where(
      and(eq(character_favorites.character_id, characterId), ownerFilter(character_favorites, owner)),
    )
}

/** 本 owner 收藏过的角色 id，最新在前。 */
export async function findFavoritedCharacterIds(db: DB, owner: Owner): Promise<string[]> {
  const rows = await db
    .select({ character_id: character_favorites.character_id })
    .from(character_favorites)
    .where(ownerFilter(character_favorites, owner))
    .orderBy(desc(character_favorites.created_at))
  return rows.map((r) => r.character_id)
}

/** 本 owner 的收藏总数。 */
export async function countFavorites(db: DB, owner: Owner): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(character_favorites)
    .where(ownerFilter(character_favorites, owner))
  return row?.n ?? 0
}
