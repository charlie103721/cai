import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { helloRoutes } from './features/hello/router'
import { characterRoutes } from './features/characters/router'
import { favoriteRoutes } from './features/favorites/router'
import { chatRoutes } from './features/chat/router'
import { topicRoutes } from './features/topics/router'
import { userRoutes } from './features/users/router'
import { guestId } from './middleware/guestId'
import { mergeGuest } from './middleware/mergeGuest'
import { dbMiddleware } from './db'
import { ok } from './util/response'
import { requestId } from './middleware/requestId'
import { requestLogger } from './middleware/requestLogger'
import { setupErrorHandler } from './middleware/errorHandler'
import { authHandler } from './middleware/authHandler'
import { jwtAuth } from './middleware/jwtAuth'
import { securityHeaders } from './middleware/securityHeaders'
import { isDev } from './config'

const app = new Hono<HonoEnv>()

// Middleware stack (order matters)
setupErrorHandler(app)
app.use(requestId)
app.use(securityHeaders)
app.use(requestLogger)

if (isDev) {
  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin?.includes('localhost') ? origin : ''),
      credentials: true,
    }),
  )
}

app.use('/api/*', dbMiddleware)

// Auth routes (before JWT middleware — auth endpoints issue tokens)
app.route('/api/auth', authHandler)

// JWT middleware (non-blocking — sets user or null)
app.use('/api/*', jwtAuth)

// Guest identity (after jwtAuth — guests get an anonymous cookie ID)
app.use('/api/*', guestId)

// Guest → account merge (after jwtAuth + guestId — folds guest data onto the
// account whenever a signed-in request still carries a guest cookie)
app.use('/api/*', mergeGuest)

// Feature routes
app.route('/api/hello', helloRoutes)
app.route('/api/characters', characterRoutes)
app.route('/api/favorites', favoriteRoutes)
app.route('/api/chat', chatRoutes)
app.route('/api/topics', topicRoutes)
app.route('/api/me', userRoutes)

app.get('/api/health', (c) => {
  return ok(c, { status: 'ok', timestamp: Date.now() })
})

// Static assets served by Cloudflare Workers Assets binding (SPA fallback)
if (!isDev) {
  app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw))
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent) {
    switch (event.cron) {
      case '0 * * * *': {
        console.log('Pinging Google...')
        const res = await fetch('https://www.google.com')
        console.log(`Google responded: ${res.status}`)
        break
      }
    }
  },
}
