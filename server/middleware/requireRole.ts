import { HTTPException } from 'hono/http-exception'
import type { Context, Next } from 'hono'
import type { UserRole } from '../features/users/roles'

/**
 * Gate a route to one or more roles. Reads role from the JWT claim
 * populated by the upstream `jwtAuth` middleware — zero DB hit per
 * request. Role is bounded-stale at the access token lifetime (see
 * ACCESS_TOKEN_EXPIRES_IN_SECONDS in lib/auth.ts).
 *
 * Mount after `jwtAuth` (which sets `c.var.user`). `authGuard` is not
 * strictly required before this because `requireRole` also rejects
 * with 401 on a null user, but chaining `authGuard` first keeps the
 * 401 semantics consistent across protected routes.
 *
 * Usage:
 *   app.get('/admin/users', jwtAuth, requireRole('admin'), handler)
 *   app.post('/sys/reap',   jwtAuth, requireRole('admin', 'system'), h)
 */
export function requireRole(...allowed: UserRole[]) {
  return (c: Context, next: Next) => {
    const user = c.get('user')
    if (!user) {
      throw new HTTPException(401, { message: 'Unauthorized' })
    }
    if (!allowed.includes(user.role)) {
      throw new HTTPException(403, { message: 'Forbidden' })
    }
    return next()
  }
}
