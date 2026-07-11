import type { Context } from 'hono'
import { createRateLimiter, type RateLimitResult } from '../../lib/rateLimit'
import type { Owner } from './owner'

/**
 * 点赞/收藏切换共用的轻量限流器（每个 owner 每小时 120 次）。
 * 单例：like 与 favorite 路由共享同一份计数，防止绕过。
 */
const engagementLimiter = createRateLimiter(120)

/** 归属：登录用户按 user_id，游客按 guest_id。 */
export const getOwner = (c: Context<HonoEnv>): Owner => {
  const user = c.get('user')
  return user ? { userId: user.userId } : { guestId: c.get('guestId') }
}

/** 按 owner 检查点赞/收藏切换限流。 */
export function checkEngagementLimit(c: Context<HonoEnv>): RateLimitResult {
  const user = c.get('user')
  const key = user ? `user:${user.userId}` : `guest:${c.get('guestId')}`
  return engagementLimiter.check(key)
}
