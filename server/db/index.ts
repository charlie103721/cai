import { createMiddleware } from "hono/factory";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { isDev } from "../config";
import * as schema from "./schema";

// Both BunSQLiteDatabase and D1Database share the same query API via Drizzle,
// so we use the D1 type as the common interface (it's the production type).
// In dev, bun:sqlite's drizzle instance is compatible at runtime.
export type DB = ReturnType<typeof drizzleD1<typeof schema>>;

/** Dev-mode singleton — reuses one local SQLite instance. */
let devDb: DB;

/**
 * Initializes the db connection per request and sets it on the Hono context.
 * - Dev: local SQLite file via bun:sqlite
 * - Production: Cloudflare D1 binding
 */
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  if (isDev) {
    if (!devDb) {
      // Variable module names prevent esbuild from resolving at bundle time
      const bunSqlite = "bun:sqlite";
      const drizzleBunPath = "drizzle-orm/bun-sqlite";
      const { Database } = await import(bunSqlite);
      const { drizzle: drizzleBun } = await import(drizzleBunPath);
      devDb = drizzleBun(new Database("local.db"), { schema }) as unknown as DB;
    }
    c.set("db", devDb);
    await next();
    return;
  }

  const db = drizzleD1(c.env.DB, { schema });
  c.set("db", db);
  await next();
});
