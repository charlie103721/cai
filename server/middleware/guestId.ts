import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'

declare module 'hono' {
  interface ContextVariableMap {
    guestId: string
  }
}

const GUEST_COOKIE = 'guest_id'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * 游客身份：未登录用户用 httpOnly cookie 里的匿名 UUID 标识，
 * 会话数据挂在 guest_id 上；注册后可按 guest_id 合并到账号。
 */
export const guestId = createMiddleware<HonoEnv>(async (c, next) => {
  let id = getCookie(c, GUEST_COOKIE)
  if (!id) {
    id = crypto.randomUUID()
    setCookie(c, GUEST_COOKIE, id, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    })
  }
  c.set('guestId', id)
  await next()
})
