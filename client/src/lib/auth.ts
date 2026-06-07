import { createAuthClient } from 'better-auth/react'

export const DEFAULT_AUTH_REDIRECT = '/'
export const AUTH_STATE_CHANGE_EVENT = 'auth-state-change'
const API_URL = import.meta.env.VITE_API_URL || ''

/** Timeout for auth API requests (ms) — prevents infinite spinner on hung server */
const AUTH_FETCH_TIMEOUT_MS = 15_000

/** Check if an error was caused by a request timeout (AbortController) */
export const isTimeoutError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

// Notify listeners when auth state changes (login/logout)
export const notifyAuthChange = () => {
  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT))
}

// Fetch current user from server (token is in httpOnly cookie).
// `role` is carried in the JWT claim and returned alongside identity.
// Kept as `string` (not a union) on the client so adding roles on the
// server doesn't force a client rebuild. Use `useHasRole("admin")` in
// components to gate UI.
export interface AuthUser {
  userId: string
  email: string
  name: string
  role: string
}

export const fetchCurrentUser = async (): Promise<AuthUser | null> => {
  const meFetch = async (): Promise<AuthUser | null> => {
    const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
    if (res.status === 401) return null
    if (!res.ok) throw new Error(`Auth check failed: ${res.status}`)
    const data = (await res.json()) as { user: AuthUser | null }
    return data.user ?? null
  }

  const user = await meFetch()
  if (user) return user

  // /me returned null — JWT cookie is either missing or past its
  // 1h expiry. If the better-auth session cookie (14d) is still
  // valid, we can transparently mint a fresh JWT via /refresh and
  // re-query /me, keeping the user signed in across access-token
  // expiries. This avoids forcing a manual re-login every hour.
  //
  // Done inline here (not via fetchApi's 401 handler) because this
  // function IS the auth check — using fetchApi would create a
  // refresh→invalidate→re-run→refresh loop.
  try {
    const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!refreshRes.ok) return null
  } catch {
    return null
  }

  return meFetch()
}

// Exchange session cookie for JWT (after OAuth redirect sets a session cookie)
export const exchangeSessionForToken = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/api/auth/token`, {
      credentials: 'include',
    })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return !!data.ok
  } catch {
    return false
  }
}

// better-auth client (used for OAuth redirect initiation and email/password)
// disableDefaultFetchPlugins removes the built-in "redirect" plugin that
// calls `window.location.href = response.url` on ANY $fetch response
// containing { url, redirect: true }. The app manages its own routing via
// React Router, and the plugin can fire unexpectedly from internal session
// refetch cycles, causing unwanted page-level redirects.
// Social sign-in (which needs the OAuth redirect) handles it explicitly in
// signIn.social() below.
export const authClient = createAuthClient({
  baseURL: API_URL || window.location.origin,
  basePath: '/api/auth',
  disableDefaultFetchPlugins: true,
  fetchOptions: {
    credentials: 'include',
    timeout: AUTH_FETCH_TIMEOUT_MS,
  },
})

// Sign in
export const signIn = {
  email: async (credentials: { email: string; password: string }) => {
    const result = await authClient.signIn.email(credentials, {
      fetchOptions: { credentials: 'include' },
      onSuccess: () => {
        notifyAuthChange()
      },
    })
    return result
  },
  social: async (provider: 'github' | 'google', returnTo?: string) => {
    // JWT cookie is set server-side during the OAuth callback, so the client
    // can go directly to the intended page — no exchangeSessionForToken needed.
    const callbackURL = returnTo ? `${window.location.origin}${returnTo}` : window.location.origin
    sessionStorage.setItem('oauth_pending', '1')
    const result = await authClient.signIn.social({ provider, callbackURL })
    // With disableDefaultFetchPlugins the built-in redirect plugin is gone,
    // so we perform the OAuth redirect ourselves using the URL returned by
    // the server.
    const data = result.data as { url?: string; redirect?: boolean } | undefined
    if (data?.url && data?.redirect) {
      window.location.href = data.url
    }
    return result
  },
}

// Sign up
export const signUp = {
  email: async (credentials: { name: string; email: string; password: string }) => {
    const result = await authClient.signUp.email(credentials, {
      fetchOptions: { credentials: 'include' },
      onSuccess: () => {
        notifyAuthChange()
      },
    })
    return result
  },
}

// HTTP status boundaries for error classification
const HTTP_STATUS_SERVER_ERROR = 500

/** Strip internal validation prefixes like `[body.email]` from error messages. */
const VALIDATION_PREFIX_RE = /^\[body\.\w+]\s*/

/** Map an auth error (from better-auth client) to a user-facing message. */
export const getAuthErrorMessage = (
  error: { status?: number; message?: string },
  fallback: string,
): string => {
  if (error.status && error.status >= HTTP_STATUS_SERVER_ERROR) {
    return 'Something went wrong. Please try again later.'
  }
  const raw = error.message || fallback
  return raw.replace(VALIDATION_PREFIX_RE, '')
}

// Sign out — clear httpOnly cookie via server
export const signOut = async () => {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // Best-effort
  }
  notifyAuthChange()
}
