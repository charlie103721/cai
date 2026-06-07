import { Hono } from 'hono'
import {
  getAuth,
  generateJWT,
  getJwtSecret,
  setAuthCookie,
  clearAuthCookie,
  getAuthCookie,
  verifyJWT,
  serializeAuthCookie,
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
} from '../lib/auth'
import { createRateLimiter } from '../lib/rateLimit'
import { delayUntil } from '../util/timing'
import logger from '../util/logger'
import { getUserRole } from '../features/users/repo'

/** Max sign-in/sign-up attempts per IP within the rate limit window */
const AUTH_MAX_ATTEMPTS = 5
/** Rate limit window duration in milliseconds (60 seconds) */
const AUTH_WINDOW_MS = 60_000
/** Minimum response time for sign-in requests to prevent timing-based user enumeration (ms) */
const SIGN_IN_MIN_RESPONSE_MS = 200

/** Maximum display name length */
const MAX_NAME_LENGTH = 100
/** RFC 5321 maximum email address length */
const MAX_EMAIL_LENGTH = 254
/** Minimum password length for registration */
const MIN_PASSWORD_LENGTH = 8

const authLimiter = createRateLimiter(AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS)

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('cf-connecting-ip') ?? null
}

/** Validate sign-up fields. Returns error message or null if valid. */
function validateSignUpBody(body: {
  name?: unknown
  email?: unknown
  password?: unknown
}): string | null {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!name) return 'Name is required'
  if (name.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or less`
  if (!email) return 'Email is required'
  if (email.length > MAX_EMAIL_LENGTH) return `Email must be ${MAX_EMAIL_LENGTH} characters or less`
  if (!password) return 'Password is required'
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  return null
}

export const authHandler = new Hono<HonoEnv>()

// Get current user from auth cookie (replaces client-side JWT parsing).
// Returns the JWT claims as-is — role comes from the token, not a
// fresh DB read, so it's bounded-stale at ACCESS_TOKEN_EXPIRES_IN_SECONDS.
authHandler.get('/me', async (c) => {
  const token = getAuthCookie(c)
  if (!token) {
    return c.json({ user: null })
  }

  const secret = getJwtSecret(c)
  const payload = await verifyJWT(token, secret)
  if (!payload) {
    clearAuthCookie(c)
    return c.json({ user: null })
  }

  return c.json({
    user: {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    },
  })
})

// Get JWT from session (for OAuth flows — sets httpOnly cookie).
// Fetches role from DB so the new token reflects the current value
// (bypasses better-auth's session cache, which can be stale for up
// to `updateAge` = 1 day).
authHandler.get('/token', async (c) => {
  const auth = getAuth(c)
  const secret = getJwtSecret(c)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session?.user) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  const role = await getUserRole(c.get('db'), session.user.id)
  const jwtToken = await generateJWT(
    {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role,
    },
    secret,
  )

  setAuthCookie(c, jwtToken)
  return c.json({ ok: true })
})

// Refresh the short-lived access JWT using the better-auth session
// as the (long-lived) refresh token. Client calls this on 401 from
// any authenticated endpoint. Returns a fresh JWT cookie with the
// user's current role, re-read from the DB.
//
// Fails with 401 if the BA session is expired / revoked / absent —
// client should treat that as "logged out" and redirect to login.
authHandler.post('/refresh', async (c) => {
  const auth = getAuth(c)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) {
    clearAuthCookie(c)
    return c.json({ error: 'Refresh token invalid' }, 401)
  }

  // Re-read role from DB so the new JWT reflects any role changes
  // since the last access token was issued. Bypasses better-auth's
  // session cache (updateAge=1d) for authz freshness.
  const role = await getUserRole(c.get('db'), session.user.id)

  const jwtToken = await generateJWT(
    {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role,
    },
    getJwtSecret(c),
  )
  setAuthCookie(c, jwtToken)
  return c.json({ ok: true })
})

// Sign out — clear auth cookie and invalidate better-auth session
authHandler.post('/logout', async (c) => {
  clearAuthCookie(c)
  // Invalidate the better-auth session and forward its Set-Cookie headers
  // so the browser clears httpOnly session cookies
  // (e.g. __Secure-better-auth.session_token, session_data).
  try {
    const auth = getAuth(c)
    const baResponse = await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    })
    const setCookies = baResponse.headers.getSetCookie?.() ?? []
    for (const cookie of setCookies) {
      c.header('Set-Cookie', cookie, { append: true })
    }
  } catch {
    // best-effort
  }
  return c.json({ ok: true })
})

// Catch-all: proxy to better-auth handler
authHandler.on(['GET', 'POST'], '/*', async (c) => {
  const url = new URL(c.req.url)
  const isAuthEndpoint = url.pathname.includes('/sign-in') || url.pathname.includes('/sign-up')
  const isSignInPost = url.pathname.includes('/sign-in/email') && c.req.method === 'POST'

  // Prevent timing-based user enumeration on sign-in by ensuring a
  // minimum response time regardless of which code path returns.
  const startTime = isSignInPost ? Date.now() : 0
  const padTiming = async () => {
    if (isSignInPost) await delayUntil(startTime, SIGN_IN_MIN_RESPONSE_MS)
  }

  if (isAuthEndpoint && c.req.method === 'POST') {
    const ip = getClientIp(c)
    if (ip) {
      const result = authLimiter.check(ip)
      if (!result.allowed) {
        await padTiming()
        return c.json(
          { error: `Rate limit exceeded. Try again in ${result.retryAfterSeconds}s.` },
          {
            status: 429,
            headers: {
              'Retry-After': String(result.retryAfterSeconds),
              'X-RateLimit-Limit': String(AUTH_MAX_ATTEMPTS),
              'X-RateLimit-Remaining': '0',
            },
          },
        )
      }
    }
  }

  // Validate sign-up body before forwarding to better-auth.
  // better-auth does not enforce name/email length or reject empty names,
  // so we reject invalid input here to match client-side constraints.
  const isSignUpPost = url.pathname.includes('/sign-up/email') && c.req.method === 'POST'
  if (isSignUpPost) {
    let body: { name?: unknown; email?: unknown; password?: unknown }
    try {
      // Clone so the original raw request body remains unconsumed for better-auth
      body = await c.req.raw.clone().json()
    } catch {
      return c.json({ message: 'Invalid request body', code: 'VALIDATION_ERROR' }, 400)
    }

    const validationError = validateSignUpBody(body)
    if (validationError) {
      return c.json({ message: validationError, code: 'VALIDATION_ERROR' }, 400)
    }
  }

  // Proxy to better-auth handler (preserves BA session cookies + headers)
  const auth = getAuth(c)
  const secret = getJwtSecret(c)

  let response: Response
  try {
    response = await auth.handler(c.req.raw)
  } catch (err) {
    const e = err as Error
    logger.error('auth.handler threw', { error: e.message, stack: e.stack })
    await padTiming()
    return c.json({ error: 'Internal server error' }, 500)
  }

  // Sign-out via better-auth — also clear our custom JWT cookie.
  if (url.pathname.includes('/sign-out')) {
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
    newResponse.headers.append('Set-Cookie', serializeAuthCookie('', 0))
    return newResponse
  }

  // better-auth returns Response(null, {status:500}) for unhandled errors
  if (response.status >= 500) {
    logger.error('auth.handler returned server error', {
      status: String(response.status),
      path: url.pathname,
    })
    await padTiming()
    return c.json({ error: 'Internal server error' }, 500)
  }

  // OAuth callback — set JWT cookie on the redirect response so the client
  // doesn't need a separate exchangeSessionForToken round trip.
  const isOAuthCallback = url.pathname.includes('/callback/')
  if (isOAuthCallback && response.status >= 300 && response.status < 400) {
    try {
      const setCookies = response.headers.getSetCookie?.() ?? []
      const cookieHeader = setCookies.map((sc: string) => sc.split(';')[0]).join('; ')

      if (cookieHeader) {
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader }),
        })

        if (session?.user) {
          // Fetch role fresh from DB — never trust session cache for
          // authz claims, even on first-issue at OAuth callback time.
          const role = await getUserRole(c.get('db'), session.user.id)
          const jwtToken = await generateJWT(
            {
              userId: session.user.id,
              email: session.user.email,
              name: session.user.name,
              role,
            },
            secret,
          )

          const newResponse = new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers),
          })
          newResponse.headers.append(
            'Set-Cookie',
            serializeAuthCookie(jwtToken, ACCESS_TOKEN_EXPIRES_IN_SECONDS),
          )
          return newResponse
        }
      }
    } catch (err) {
      const e = err as Error
      logger.error('OAuth callback JWT injection failed', { error: e.message })
      // Fall through — client will use exchangeSessionForToken as fallback
    }
  }

  // Email/password sign-in/sign-up — set JWT as httpOnly cookie
  if (isAuthEndpoint && response.ok) {
    try {
      const clonedResponse = response.clone()
      const data = (await clonedResponse.json()) as {
        user?: { id: string; email: string; name: string }
      }

      if (data.user) {
        // Fetch role fresh from DB so the new JWT reflects the current
        // value (new sign-ups get the default 'user'; existing users
        // who just signed in pick up any role change since their last
        // access token).
        const role = await getUserRole(c.get('db'), data.user.id)
        const jwtToken = await generateJWT(
          {
            userId: data.user.id,
            email: data.user.email,
            name: data.user.name,
            role,
          },
          secret,
        )

        const sanitizedBody = {
          user: { name: data.user.name, email: data.user.email },
        }

        const newResponse = new Response(JSON.stringify(sanitizedBody), {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        })
        newResponse.headers.append(
          'Set-Cookie',
          serializeAuthCookie(jwtToken, ACCESS_TOKEN_EXPIRES_IN_SECONDS),
        )

        await padTiming()
        return newResponse
      }
    } catch (err) {
      const e = err as Error
      logger.error('auth post-processing failed', { error: e.message, path: url.pathname })
      await padTiming()
      return c.json({ error: 'Internal server error' }, 500)
    }
  }

  await padTiming()
  return response
})
