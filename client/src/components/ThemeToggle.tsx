import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'

const CYCLE: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system']

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label={`Theme: ${theme}. Click for ${next}`}
      onClick={() => setTheme(next)}
    >
      {theme === 'light' ? (
        <Sun className="h-4 w-4" />
      ) : theme === 'dark' ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Monitor className="h-4 w-4" />
      )}
    </Button>
  )
}
