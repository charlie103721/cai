import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { sign, verify } from 'hono/jwt'
import { setCookie, getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { isDev } from '../config'
import type { UserRole } from '../features/users/roles'
import type { DB } from '../db'
import * as schema from '../db/schema'

// ─── Two-tier auth tokens ────────────────────────────────────────
// Tier 1: better-auth session (the refresh token equivalent)
//   - Long-lived (14d), DB-backed, revocable on logout
//   - Auto-extended every `updateAge` (1d)
//   - Used by POST /api/auth/refresh to mint new access tokens
// Tier 2: custom JWT (the access token)
//   - Short-lived (1h), httpOnly cookie, embeds { userId, email, name, role }
//   - Role claim is read by requireRole middleware — zero DB hit per request
//   - On expiry, client calls /api/auth/refresh to get a fresh one
//
// Role staleness is bounded by ACCESS_TOKEN_EXPIRES_IN_SECONDS. Role
// changes take effect on the user's next refresh (≤1h by default).
// ──────────────────────────────────────────────────────────────────

// Session config (Tier 1 — refresh)
const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 14 // 14 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24 // 1 day
const COOKIE_CACHE_MAX_AGE_SECONDS = 60 * 5 // 5 minutes

// Access token config (Tier 2 — JWT). Short-lived on purpose: bounds
// role-claim staleness to this window. Shorten for stricter security
// (e.g. 15 * 60 for 15 min); lengthen for lower refresh churn (e.g.
// 4 * 60 * 60 for 4 hours). 1 hour is the OAuth2-canonical default.
export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 60 // 1 hour

// Auth cookie config
export const AUTH_COOKIE_NAME = 'auth_token'

// PBKDF2 password hashing — fast enough for Workers free tier CPU limits
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_HASH = 'SHA-256'
const PBKDF2_KEY_LENGTH = 256 // bits
const SALT_LENGTH = 16 // bytes
const PBKDF2_PREFIX = 'pbkdf2:'

// Hex encoding helpers. TS 5.7+ made `Uint8Array` generic over its
// backing buffer (`ArrayBuffer` vs `SharedArrayBuffer`) and Web Crypto
// now only accepts `ArrayBuffer`-backed views, so these helpers are
// explicit about allocating a plain `ArrayBuffer`.
function toHex(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g)!
  const out = new Uint8Array(new ArrayBuffer(pairs.length))
  for (let i = 0; i < pairs.length; i++) out[i] = parseInt(pairs[i], 16)
  return out
}

// Allocate a Uint8Array backed by an explicit ArrayBuffer so its
// generic param narrows to `Uint8Array<ArrayBuffer>` (not the default
// `ArrayBufferLike`, which Web Crypto rejects).
function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(s)
  const buf = new ArrayBuffer(enc.byteLength)
  const view = new Uint8Array(buf)
  view.set(enc)
  return view
}

async function pbkdf2Hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_LENGTH)))
  const key = await crypto.subtle.importKey('raw', utf8Bytes(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    PBKDF2_KEY_LENGTH,
  )
  return `${PBKDF2_PREFIX}${toHex(salt)}:${toHex(derived)}`
}

async function pbkdf2Verify(stored: string, password: string): Promise<boolean> {
  const unprefixed = stored.slice(PBKDF2_PREFIX.length)
  const [saltHex, hashHex] = unprefixed.split(':')
  if (!saltHex || !hashHex) return false
  const salt = fromHex(saltHex)
  const key = await crypto.subtle.importKey('raw', utf8Bytes(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    PBKDF2_KEY_LENGTH,
  )
  return toHex(derived) === hashHex
}

async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (!hash.startsWith(PBKDF2_PREFIX)) return false
  return pbkdf2Verify(hash, password)
}

export interface JWTPayload {
  userId: string
  email: string
  name: string
  role: UserRole
  exp: number
}

interface AuthEnv {
  betterAuthSecret: string
  betterAuthUrl: string
  githubClientId?: string
  githubClientSecret?: string
  googleClientId?: string
  googleClientSecret?: string
  clientUrl?: string
}

function createAuthInstance(db: DB, env: AuthEnv) {
  return betterAuth({
    secret: env.betterAuthSecret,
    baseURL: env.betterAuthUrl,
    basePath: '/api/auth',
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      password: { hash: pbkdf2Hash, verify: verifyPassword },
    },
    socialProviders: {
      github: {
        clientId: env.githubClientId || '',
        clientSecret: env.githubClientSecret || '',
      },
      google: {
        clientId: env.googleClientId || '',
        clientSecret: env.googleClientSecret || '',
      },
    },
    trustedOrigins: isDev
      ? ['http://localhost:*', 'http://*.localhost:*', 'https://*.localhost:*']
      : [env.clientUrl!, 'https://*.workers.dev'],
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: true, maxAge: COOKIE_CACHE_MAX_AGE_SECONDS },
    },
    // Declare role as a server-controlled additional field on the user.
    // `input: false` is load-bearing security: it prevents sign-up /
    // update-user API bodies from setting `role`, closing the obvious
    // privilege-escalation path. Role can only be changed by direct DB
    // write or a dedicated admin endpoint that writes via Drizzle.
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
      },
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}

// Cached instance for dev (avoid re-creating on every request)
let cachedAuth: ReturnType<typeof betterAuth> | null = null

export function getAuth(c: Context<HonoEnv>) {
  const db = c.get('db')

  if (isDev) {
    cachedAuth ??= createAuthInstance(db, {
      betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
      betterAuthUrl: process.env.BETTER_AUTH_URL!,
      githubClientId: process.env.GITHUB_CLIENT_ID,
      githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
      clientUrl: process.env.CLIENT_URL,
    })
    return cachedAuth
  }

  // Production: per-request (D1 binding is request-scoped)
  // Preview workers (.workers.dev) derive URL from request instead of secrets
  const requestUrl = new URL(c.req.url)
  const isPreview = requestUrl.hostname.endsWith('.workers.dev')
  const baseUrl = isPreview ? requestUrl.origin : c.env.BETTER_AUTH_URL
  const clientUrl = isPreview ? requestUrl.origin : c.env.CLIENT_URL

  return createAuthInstance(db, {
    betterAuthSecret: c.env.BETTER_AUTH_SECRET,
    betterAuthUrl: baseUrl,
    githubClientId: c.env.GITHUB_CLIENT_ID,
    githubClientSecret: c.env.GITHUB_CLIENT_SECRET,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
    clientUrl,
  })
}

// JWT utilities (async — uses Web Crypto API for Cloudflare Workers)
export function getJwtSecret(c: Context<HonoEnv>): string {
  return isDev ? process.env.BETTER_AUTH_SECRET! : c.env.BETTER_AUTH_SECRET
}

export async function generateJWT(
  payload: Omit<JWTPayload, 'exp'>,
  secret: string,
): Promise<string> {
  return sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRES_IN_SECONDS },
    secret,
  )
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    return (await verify(token, secret, 'HS256')) as unknown as JWTPayload
  } catch {
    return null
  }
}

// Cookie attribute constants — always HttpOnly + Secure + SameSite=Strict.
// Portless provides HTTPS in dev, and production is always HTTPS, so Secure
// is safe in every environment.  Using a single definition prevents duplicate
// cookies with mismatched attributes.
const AUTH_COOKIE_ATTRS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict' as const,
  path: '/',
}

// Cookie helpers — httpOnly + Secure + SameSite=Strict for XSS/CSRF protection
export function setAuthCookie(c: Context, token: string) {
  setCookie(c, AUTH_COOKIE_NAME, token, {
    ...AUTH_COOKIE_ATTRS,
    maxAge: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  })
}

export function clearAuthCookie(c: Context) {
  // Must match the attributes used in setAuthCookie so the browser properly
  // expires the cookie (some browsers ignore Set-Cookie deletion when
  // Secure / SameSite don't match the original cookie).
  setCookie(c, AUTH_COOKIE_NAME, '', {
    ...AUTH_COOKIE_ATTRS,
    maxAge: 0,
  })
}

export function getAuthCookie(c: Context): string | undefined {
  return getCookie(c, AUTH_COOKIE_NAME)
}

/**
 * Serializes an auth cookie as a raw Set-Cookie header string.
 * Use this when appending to a proxied Response (where Hono's setCookie
 * helper can't be used because it only operates on the context response).
 */
export function serializeAuthCookie(value: string, maxAge: number): string {
  return [
    `${AUTH_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ].join('; ')
}

export type Auth = ReturnType<typeof betterAuth>
