import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: ["server/**/*.test.ts"],
          // ConnectionHub DO tests run in the workers pool (separate project
          // below), not in the plain node pool.
          exclude: ["**/node_modules/**", "**/*.workers.test.ts"],
        },
      },
      {
        test: {
          name: "client",
          include: ["client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      // Durable Object protocol tests — @cloudflare/vitest-pool-workers (workerd).
      "./vitest.workers.config.ts",
    ],
  },
});
