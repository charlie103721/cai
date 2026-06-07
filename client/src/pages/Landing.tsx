import { Link, Navigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { kebabToTitleCase } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const APP_NAME = kebabToTitleCase(__APP_NAME__)
const APP_SUBTITLE = 'A fullstack Cloudflare Workers app'

export default function Landing() {
  const { isAuthenticated, isPending } = useAuth()

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Hello World</h1>
      <h1 className="text-5xl font-bold tracking-tight">{APP_NAME}</h1>
      <p className="text-xl text-muted-foreground">{APP_SUBTITLE}</p>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link to="/signup">Get Started</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  )
}
