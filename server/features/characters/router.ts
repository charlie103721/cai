import { Hono } from 'hono'
import { ok, fail } from '../../util/response'
import { getCharacter } from './data'
import { getOwner, checkEngagementLimit } from '../shared/engagement'
import {
  toggleLike,
  countLikes,
  listEnrichedCharacters,
  getEnrichedCharacter,
} from './repo'

const characterRoutes = new Hono<HonoEnv>()

// 富集花名册：每个角色带 like_count/liked/chat_count/favorited（persona 从不下发）
characterRoutes.get('/', async (c) => {
  const list = await listEnrichedCharacters(c.get('db'), getOwner(c))
  return ok(c, list)
})

characterRoutes.get('/:id', async (c) => {
  const enriched = await getEnrichedCharacter(c.get('db'), getOwner(c), c.req.param('id'))
  if (!enriched) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)
  return ok(c, enriched)
})

// 点赞切换（游客可用）→ { liked, like_count = seed_likes + 真实行数 }
characterRoutes.post('/:id/like', async (c) => {
  const character = getCharacter(c.req.param('id'))
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)

  const limit = checkEngagementLimit(c)
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSeconds))
    return fail(c, 'RATE_LIMITED', 'Too many requests', 429)
  }

  const db = c.get('db')
  const { liked } = await toggleLike(db, getOwner(c), character.id)
  const n = await countLikes(db, character.id)
  return ok(c, { liked, like_count: character.seed_likes + n })
})

export { characterRoutes }
