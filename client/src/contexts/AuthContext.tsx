import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCurrentUser,
  exchangeSessionForToken,
  AUTH_STATE_CHANGE_EVENT,
  type AuthUser,
} from '@/lib/auth'
const OAUTH_PENDING_KEY = 'oauth_pending'
const AUTH_QUERY_KEY = ['auth', 'me'] as const

export interface AuthSession {
  user: { id: string; email: string; name: string; role: string }
}

export interface AuthContextValue {
  session: AuthSession | null
  user: AuthUser | null
  isPending: boolean
  isFetching: boolean
  isAuthenticated: boolean
  oauthExchanging: boolean
}

// Context is co-located with its provider. Splitting into a separate
// file for fast-refresh purity would fragment a small module for
// negligible DX benefit.
// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const oauthHandled = useRef(false)
  const [oauthExchanging, setOauthExchanging] = useState(
    () => !!sessionStorage.getItem(OAUTH_PENDING_KEY),
  )

  useEffect(() => {
    if (oauthHandled.current) return
    const oauthPending = sessionStorage.getItem(OAUTH_PENDING_KEY)
    if (oauthPending) {
      oauthHandled.current = true
      exchangeSessionForToken().finally(async () => {
        sessionStorage.removeItem(OAUTH_PENDING_KEY)
        await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
        setOauthExchanging(false)
      })
    }
  }, [queryClient])

  // React Query deduplicates: multiple components sharing this query key
  // won't trigger duplicate /api/auth/me requests
  const {
    data: user = null,
    isPending,
    isFetching,
  } = useQuery<AuthUser | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchCurrentUser,
    staleTime: 30_000,
    retry: false,
  })

  const invalidateAuth = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
  }, [queryClient])

  useEffect(() => {
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, invalidateAuth)
    return () => window.removeEventListener(AUTH_STATE_CHANGE_EVENT, invalidateAuth)
  }, [invalidateAuth])

  const value = useMemo<AuthContextValue>(() => {
    const session: AuthSession | null = user
      ? { user: { id: user.userId, email: user.email, name: user.name, role: user.role } }
      : null
    return { session, user, isPending, isFetching, isAuthenticated: !!user, oauthExchanging }
  }, [user, isPending, isFetching, oauthExchanging])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
