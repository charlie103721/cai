import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

/**
 * Convenience hook for role-gated UI. Returns `true` if the current
 * user's role matches any of `allowed`. Returns `false` when there's
 * no authenticated user. Mirrors the server-side `requireRole`
 * middleware so UI hiding and server-side enforcement stay aligned.
 *
 * Usage:
 *   const isAdmin = useHasRole("admin");
 *   if (isAdmin) { ... }
 */
export function useHasRole(...allowed: string[]): boolean {
  const { user } = useAuth()
  return user != null && allowed.includes(user.role)
}
