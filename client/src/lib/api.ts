import { QueryClient } from '@tanstack/react-query'
import { AUTH_STATE_CHANGE_EVENT } from './auth'

const THIRTY_SECONDS = 30_000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: THIRTY_SECONDS,
      retry: 1,
    },
  },
})

/**
 * Single-flight refresh. If N concurrent requests all see a 401 at
 * once, they share ONE `/api/auth/refresh` call via this module-scoped
 * promise instead of hammering the server with N refresh attempts.
 * Cleared as soon as the single call settles so the next 401 wave
 * gets its own refresh.
 */
let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      return res.ok
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...options?.headers,
  }

  const doFetch = () => fetch(path, { ...options, headers, credentials: 'include' })

  let res = await doFetch()

  // Access token expired? Try one refresh + retry. Skip for the
  // refresh endpoint itself to avoid an infinite loop.
  if (res.status === 401 && !path.includes('/api/auth/refresh')) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await doFetch()
    } else {
      // Refresh failed — BA session is gone. Broadcast the existing
      // auth-state-change event so `AuthContext` re-fetches /me,
      // which will return null, flipping `isAuthenticated` to false
      // and letting protected-route guards redirect to /login.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT))
      }
      throw new Error('Unauthorized')
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((body as { message?: string }).message || res.statusText)
  }

  return res.json() as Promise<T>
}
