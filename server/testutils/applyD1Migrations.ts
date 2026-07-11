import { applyD1Migrations, env } from 'cloudflare:test'

// 在所有 workers-pool 测试前，把真实迁移应用到 miniflare 的本地 D1（基础层，
// 所有测试可见）。TEST_MIGRATIONS 由 vitest.workers.config.ts 通过 readD1Migrations 注入。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
