import { serve } from '@hono/node-server'
import worker from './index'

const DEFAULT_PORT = 8443

function resolvePort(): number {
  const port = Number(process.env.PORT)
  if (!Number.isFinite(port) || port <= 0) {
    return DEFAULT_PORT
  }
  return port
}

// Mock ExecutionContext for the local dev harness. CF Workers'
// ExecutionContext gained `props` + `exports` fields over time —
// we don't use them in dev, but the type must be present so
// `worker.fetch(..., ctx)` typechecks.
const executionContext: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {} as ExecutionContext['exports'],
}

const port = resolvePort()

const server = serve(
  {
    port,
    fetch: (request: Request) => worker.fetch(request, {} as CloudflareBindings, executionContext),
  },
  (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`)
  },
)

const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
