import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import type { DB } from '../db'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

/** 读取一个迁移文件，按 drizzle 的 statement-breakpoint 逐条执行。 */
export function applyMigrationFile(raw: Database.Database, tag: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) raw.exec(s)
  }
}

/** 按 journal 顺序应用的所有迁移 tag。 */
export function migrationTags(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.replace(/\.sql$/, ''))
}

/** 一个全新的、跑完全部迁移的内存数据库（真实迁移 SQL）。 */
export function createMigratedDb(): { db: DB; raw: Database.Database } {
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  for (const tag of migrationTags()) applyMigrationFile(raw, tag)
  const db = drizzle(raw, { schema }) as unknown as DB
  return { db, raw }
}

/** 插入一个最小可用的 user 行，满足 user_id 外键（restrict）。 */
export function seedUser(raw: Database.Database, id: string) {
  const now = Math.floor(Date.now() / 1000)
  raw
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES (?,?,?,0,'user',?,?)`,
    )
    .run(id, id, `${id}@example.com`, now, now)
}
