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
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
}

type HonoEnv = {
  Bindings: CloudflareBindings;
  Variables: { db: import("./db").DB };
};
