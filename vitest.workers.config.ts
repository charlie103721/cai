import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

/**
 * 独立的 vitest 项目：ConnectionHub Durable Object 协议测试，跑在真实的 workerd
 * 里（@cloudflare/vitest-pool-workers），配 miniflare 的本地 D1 / DO。
 * 由根 vitest.config.ts 的 projects 引用；与既有 node 项目互不影响。
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'server/db/migrations'))
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // 每条气泡零停顿，帧确定且瞬时到达。
            WS_PACING_MS: '0',
            // 空 key：新鲜 send_message 会在 getLlmConfigFromEnv 处直接抛错 →
            // CHAT_UNAVAILABLE（不触网）；幂等重放路径根本不调 LLM。
            OPENROUTER_API_KEY: '',
          },
        },
      }
    }),
  ],
  test: {
    name: 'workers',
    include: ['server/**/*.workers.test.ts'],
    setupFiles: ['./server/testutils/applyD1Migrations.ts'],
  },
})
