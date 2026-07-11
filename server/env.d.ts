// Auth-related env bindings (set via `wrangler secret put`)
interface CloudflareBindings {
  ASSETS: Fetcher;
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CLIENT_URL: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  // Optional: fixed per-bubble pacing gap in ms for the ConnectionHub DO
  // (tests set "0" for deterministic, instant delivery). Unset → random 400–900ms.
  WS_PACING_MS?: string;
}

type HonoEnv = {
  Bindings: CloudflareBindings;
  Variables: { db: import("./db").DB };
};
