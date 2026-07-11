import { and, count, eq } from 'drizzle-orm'
import type { DB } from '../../db'
import { character_likes, character_favorites, conversations } from '../../db/schema'
import { ownerColumns, ownerFilter, type Owner } from '../shared/owner'
import { CHARACTERS, getCharacter, type Character } from './data'

/** 计数富集后的公开角色（不含 persona）。 */
export interface EnrichedCharacter {
  id: string
  name: string
  emoji: string
  tagline: string
  greeting: string
  hue: number
  like_count: number
  liked: boolean
  chat_count: number
  favorited: boolean
}

/**
 * 切换点赞——竞态安全，无「先读后写」：
 * INSERT ... ON CONFLICT DO NOTHING RETURNING；有行返回 → 新点上（liked:true），
 * 否则说明已存在 → 按 owner+character 删除（liked:false）。
 */
export async function toggleLike(
  db: DB,
  owner: Owner,
  characterId: string,
): Promise<{ liked: boolean }> {
  const inserted = await db
    .insert(character_likes)
    .values({ id: crypto.randomUUID(), ...ownerColumns(owner), character_id: characterId })
    .onConflictDoNothing()
    .returning()

  if (inserted.length > 0) return { liked: true }

  await db
    .delete(character_likes)
    .where(and(eq(character_likes.character_id, characterId), ownerFilter(character_likes, owner)))
  return { liked: false }
}

/** 某角色的真实点赞行数（不含 seed）。 */
export async function countLikes(db: DB, characterId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(character_likes)
    .where(eq(character_likes.character_id, characterId))
  return row?.n ?? 0
}

type CountRow = { character_id: string; n: number }
type IdRow = { character_id: string }

/**
 * 一次 db.batch（生产 D1 单次往返）取齐富集所需的四组数据：
 * ①各角色点赞数 ②各角色会话数 ③本 owner 点赞过的 id ④本 owner 收藏过的 id。
 * 测试用的 better-sqlite3 驱动没有 batch，退化为并行执行（语义一致）。
 */
async function fetchEnrichment(db: DB, owner: Owner) {
  const likeCountsQ = db
    .select({ character_id: character_likes.character_id, n: count() })
    .from(character_likes)
    .groupBy(character_likes.character_id)
  const chatCountsQ = db
    .select({ character_id: conversations.character_id, n: count() })
    .from(conversations)
    .groupBy(conversations.character_id)
  const likedIdsQ = db
    .select({ character_id: character_likes.character_id })
    .from(character_likes)
    .where(ownerFilter(character_likes, owner))
  const favoritedIdsQ = db
    .select({ character_id: character_favorites.character_id })
    .from(character_favorites)
    .where(ownerFilter(character_favorites, owner))

  const runner = db as unknown as {
    batch?: (queries: readonly unknown[]) => Promise<unknown[]>
  }
  const [likeCounts, chatCounts, likedIds, favoritedIds] = (
    typeof runner.batch === 'function'
      ? await runner.batch([likeCountsQ, chatCountsQ, likedIdsQ, favoritedIdsQ])
      : await Promise.all([likeCountsQ, chatCountsQ, likedIdsQ, favoritedIdsQ])
  ) as [CountRow[], CountRow[], IdRow[], IdRow[]]

  return {
    likeMap: new Map(likeCounts.map((r) => [r.character_id, r.n])),
    chatMap: new Map(chatCounts.map((r) => [r.character_id, r.n])),
    likedSet: new Set(likedIds.map((r) => r.character_id)),
    favoritedSet: new Set(favoritedIds.map((r) => r.character_id)),
  }
}

function enrich(
  ch: Character,
  maps: {
    likeMap: Map<string, number>
    chatMap: Map<string, number>
    likedSet: Set<string>
    favoritedSet: Set<string>
  },
): EnrichedCharacter {
  return {
    id: ch.id,
    name: ch.name,
    emoji: ch.emoji,
    tagline: ch.tagline,
    greeting: ch.greeting,
    hue: ch.hue,
    like_count: ch.seed_likes + (maps.likeMap.get(ch.id) ?? 0),
    liked: maps.likedSet.has(ch.id),
    chat_count: ch.seed_chats + (maps.chatMap.get(ch.id) ?? 0),
    favorited: maps.favoritedSet.has(ch.id),
  }
}

/** 全量角色的富集列表（静态花名册 + 计数/归属，persona 从不下发）。 */
export async function listEnrichedCharacters(db: DB, owner: Owner): Promise<EnrichedCharacter[]> {
  const maps = await fetchEnrichment(db, owner)
  return CHARACTERS.map((ch) => enrich(ch, maps))
}

/** 单个角色的富集视图；未知 id → null。 */
export async function getEnrichedCharacter(
  db: DB,
  owner: Owner,
  id: string,
): Promise<EnrichedCharacter | null> {
  const ch = getCharacter(id)
  if (!ch) return null
  const maps = await fetchEnrichment(db, owner)
  return enrich(ch, maps)
}
