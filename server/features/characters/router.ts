import { Hono } from 'hono'
import { ok, fail } from '../../util/response'
import { CHARACTERS, getCharacter, toPublicCharacter } from './data'

const characterRoutes = new Hono<HonoEnv>()

characterRoutes.get('/', (c) => {
  return ok(c, CHARACTERS.map(toPublicCharacter))
})

characterRoutes.get('/:id', (c) => {
  const character = getCharacter(c.req.param('id'))
  if (!character) return fail(c, 'CHARACTER_NOT_FOUND', 'Character not found', 404)
  return ok(c, toPublicCharacter(character))
})

export { characterRoutes }
