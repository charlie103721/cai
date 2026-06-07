import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: ["server/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "client",
          include: ["client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
