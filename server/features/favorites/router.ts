import { Hono } from 'hono'
import { ok, fail } from '../../util/response'
import { getCharacter, toFavoriteCharacter } from '../characters/data'
import { getOwner, checkEngagementLimit } from '../shared/engagement'
import { addFavorite, removeFavorite, findFavoritedCharacterIds } from './repo'

const favoriteRoutes = new Hono<HonoEnv>()

// 我的收藏（游客可用），最新在前；未知 id 跳过。行形状 { id,name,emoji,tagline,greeting,hue }
favoriteRoutes.get('/', async (c) => {
  const ids = await findFavoritedCharacterIds(c.get('db'), getOwner(c))
  const data = ids.flatMap((id) => {
    const character = getCharacter(id)
    return character ? [toFavoriteCharacter(character)] : []
  })
  return ok(c, data)
})

// 收藏（幂等）→ { favorited: true }，201
favoriteRoutes.post('/:characterId', async (c) => {
  const character = getCharacter(c.req.param('characterId'))
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)

  const limit = checkEngagementLimit(c)
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSeconds))
    return fail(c, 'RATE_LIMITED', 'Too many requests', 429)
  }

  await addFavorite(c.get('db'), getOwner(c), character.id)
  return ok(c, { favorited: true }, 201)
})

// 取消收藏（幂等）→ { favorited: false }
favoriteRoutes.delete('/:characterId', async (c) => {
  const character = getCharacter(c.req.param('characterId'))
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)

  const limit = checkEngagementLimit(c)
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSeconds))
    return fail(c, 'RATE_LIMITED', 'Too many requests', 429)
  }

  await removeFavorite(c.get('db'), getOwner(c), character.id)
  return ok(c, { favorited: false })
})

export { favoriteRoutes }
