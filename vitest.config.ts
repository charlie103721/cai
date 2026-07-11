import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
        plugins: [react()],
        resolve: {
          alias: { "@": path.resolve(__dirname, "./client/src") },
        },
        test: {
          name: "client",
          include: ["client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./client/src/test/setup.ts"],
        },
      },
      // Durable Object protocol tests — @cloudflare/vitest-pool-workers (workerd).
      "./vitest.workers.config.ts",
    ],
  },
});
