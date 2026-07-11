import { Hono } from 'hono'
import { z } from 'zod'
import { ok, fail } from '../../util/response'
import { authGuard } from '../../middleware/authGuard'
import { getOwner } from '../shared/engagement'
import {
  getProfile,
  updateProfile,
  getStats,
  HandleTakenError,
} from './repo'

const userRoutes = new Hono<HonoEnv>()

// 我的资料（需登录）→ { name, handle, favorite_team, image }
userRoutes.get('/profile', authGuard, async (c) => {
  const user = c.get('user')!
  const profile = await getProfile(c.get('db'), user.userId)
  if (!profile) return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  return ok(c, profile)
})

// handle 先小写再校验；role 永不被接受（Zod 会剥离未知字段，且我们只取 handle/favorite_team）
const patchProfileSchema = z.object({
  handle: z
    .string()
    .transform((s) => s.toLowerCase())
    .refine((s) => /^[a-z0-9_]{3,20}$/.test(s), {
      message: 'handle must be 3-20 chars of a-z, 0-9, or _',
    })
    .optional(),
  favorite_team: z.string().max(40).optional(),
})

// 更新资料（需登录）；handle 唯一冲突 → 409 HANDLE_TAKEN（捕获约束错误，无先查后写竞态）
userRoutes.patch('/profile', authGuard, async (c) => {
  const user = c.get('user')!
  const parsed = patchProfileSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 'INVALID_BODY', parsed.error.message, 400)

  try {
    const profile = await updateProfile(c.get('db'), user.userId, parsed.data)
    return ok(c, profile)
  } catch (err) {
    if (err instanceof HandleTakenError) {
      return fail(c, 'HANDLE_TAKEN', 'Handle already taken', 409)
    }
    throw err
  }
})

// 我的统计（游客可用）：一次 batch 取三个 owner-scoped 计数
userRoutes.get('/stats', async (c) => {
  const stats = await getStats(c.get('db'), getOwner(c))
  return ok(c, stats)
})

export { userRoutes }
