import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import { mergeGuest as mergeGuestRows } from '../features/users/repo'

const GUEST_COOKIE = 'guest_id'

/**
 * 游客 → 账号合并。挂在 jwtAuth + guestId 之后的 /api/*：
 * 当请求同时带着已登录用户和一个 guest_id cookie 时，把该游客的点赞/收藏/会话
 * 归并到账号，然后清掉 cookie（maxAge 0）。覆盖注册、登录、换设备三种场景
 * （只要一次请求里同时存在用户会话与游客 cookie 就会跑）。
 *
 * 只读请求里已存在的 cookie（getCookie 读的是请求头）——所以 guestId 中间件
 * 刚为新设备下发的 cookie 不会误触发合并；合并本身幂等，重复跑匹配 0 行。
 */
export const mergeGuest = createMiddleware<HonoEnv>(async (c, next) => {
  const user = c.get('user')
  const guestCookie = getCookie(c, GUEST_COOKIE)

  if (user && guestCookie) {
    await mergeGuestRows(c.get('db'), guestCookie, user.userId)
    setCookie(c, GUEST_COOKIE, '', {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
    })
  }

  await next()
})
