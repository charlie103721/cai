/// <reference types="@cloudflare/vitest-pool-workers/types" />

// TEST_MIGRATIONS 由 vitest.workers.config.ts 通过 miniflare bindings 注入，
// 补进 workers-pool 测试里 `env` 的类型（env 类型是 Cloudflare.Env）。
import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
