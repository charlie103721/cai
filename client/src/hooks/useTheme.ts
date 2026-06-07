import { useEffect, useCallback } from 'react'
import { useLocalStorage } from 'usehooks-ts'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const DEFAULT_THEME: Theme = 'system'

function getSystemPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemPreference() : theme
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function useTheme() {
  const [theme, setThemeState] = useLocalStorage<Theme>(STORAGE_KEY, DEFAULT_THEME)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next)
  }, [setThemeState])

  // Apply on mount and listen for system preference changes
  useEffect(() => {
    applyTheme(theme)

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  return { theme, setTheme } as const
}

/**
 * Initialize theme from localStorage before React renders.
 * Call once in the app entry point to prevent flash of wrong theme.
 * Handles both raw strings and JSON-serialized values from useLocalStorage.
 */
export function initTheme() {
  try {
    let stored = localStorage.getItem(STORAGE_KEY)
    if (stored) try { stored = JSON.parse(stored) } catch { /* use as-is */ }
    const theme: Theme = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : DEFAULT_THEME
    applyTheme(theme)
  } catch {
    applyTheme(DEFAULT_THEME)
  }
}
