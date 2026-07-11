import { describe, test, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrationFile, createMigratedDb, migrationTags } from '../testutils/db'

const F1_TAG = '0002_grey_the_call'

describe('F1 migration — fresh DB', () => {
  test('all migrations apply cleanly and create the new schema', () => {
    const { raw } = createMigratedDb()
    const tables = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['character_likes', 'character_favorites', 'conversation_characters']),
    )

    // New columns present on existing tables.
    const conv = raw.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>
    expect(conv.map((c) => c.name)).toEqual(
      expect.arrayContaining(['type', 'topic_id', 'last_read_seq']),
    )
    const msg = raw.prepare(`PRAGMA table_info(chat_messages)`).all() as Array<{ name: string }>
    expect(msg.map((c) => c.name)).toEqual(
      expect.arrayContaining(['seq', 'sender_character_id', 'kind', 'status', 'media_url', 'client_msg_id']),
    )
    const u = raw.prepare(`PRAGMA table_info(user)`).all() as Array<{ name: string }>
    expect(u.map((c) => c.name)).toEqual(expect.arrayContaining(['handle', 'favorite_team']))
    const dt = raw.prepare(`PRAGMA table_info(daily_topics)`).all() as Array<{ name: string }>
    expect(dt.map((c) => c.name)).toEqual(
      expect.arrayContaining(['headline', 'heat', 'tags', 'character_ids', 'hue', 'pinned']),
    )
  })

  test('unique (conversation_id, seq) index is enforced', () => {
    const { raw } = createMigratedDb()
    const now = Math.floor(Date.now() / 1000)
    raw
      .prepare(
        `INSERT INTO conversations (id, guest_id, character_id, created_at, updated_at) VALUES ('c1','g1','x',?,?)`,
      )
      .run(now, now)
    const ins = raw.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, seq, created_at) VALUES (?,?,?,?,?,?)`,
    )
    ins.run('m1', 'c1', 'user', 'a', 1, now)
    expect(() => ins.run('m2', 'c1', 'user', 'b', 1, now)).toThrow()
  })

  test('partial unique (conversation_id, client_msg_id) ignores NULLs but blocks dupes', () => {
    const { raw } = createMigratedDb()
    const now = Math.floor(Date.now() / 1000)
    raw
      .prepare(
        `INSERT INTO conversations (id, guest_id, character_id, created_at, updated_at) VALUES ('c1','g1','x',?,?)`,
      )
      .run(now, now)
    const ins = raw.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, seq, client_msg_id, created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    // Two NULL client_msg_id rows are allowed (NULLs distinct).
    ins.run('m1', 'c1', 'user', 'a', 1, null, now)
    ins.run('m2', 'c1', 'assistant', 'b', 2, null, now)
    // Same non-null client_msg_id in the same conversation is rejected.
    ins.run('m3', 'c1', 'user', 'c', 3, 'cid-1', now)
    expect(() => ins.run('m4', 'c1', 'user', 'd', 4, 'cid-1', now)).toThrow()
  })
})

describe('F1 migration — backfill on a seeded (production-shape) DB', () => {
  function seededThenMigrated() {
    const raw = new Database(':memory:')
    raw.pragma('foreign_keys = ON')
    // Old schema only (before F1).
    for (const tag of migrationTags()) {
      if (tag === F1_TAG) break
      applyMigrationFile(raw, tag)
    }

    const now = Math.floor(Date.now() / 1000)
    raw
      .prepare(
        `INSERT INTO conversations (id, guest_id, character_id, title, created_at, updated_at) VALUES ('c1','g1','argentina-uncle','hi',?,?)`,
      )
      .run(now, now)
    raw
      .prepare(
        `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES ('c2',NULL,'rival-mouth',NULL,?,?)`,
      )
      .run(now, now)
    const rows: Array<[string, string, string, string]> = [
      ['m1', 'c1', 'assistant', 'greeting'],
      ['m2', 'c1', 'user', 'hello'],
      ['m3', 'c1', 'assistant', 'reply1'],
      ['m4', 'c1', 'user', 'more'],
      ['m5', 'c1', 'assistant', 'reply2'],
      ['m6', 'c2', 'assistant', 'g2-greeting'],
      ['m7', 'c2', 'user', 'yo'],
    ]
    const ins = raw.prepare(
      `INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)`,
    )
    let t = now
    for (const [id, conv, role, content] of rows) ins.run(id, conv, role, content, t++)

    // Apply the F1 migration (backfill runs here).
    applyMigrationFile(raw, F1_TAG)
    return raw
  }

  test('seq is backfilled consecutively per conversation in insertion order', () => {
    const raw = seededThenMigrated()
    const c1 = raw
      .prepare(`SELECT id, seq FROM chat_messages WHERE conversation_id='c1' ORDER BY seq`)
      .all() as Array<{ id: string; seq: number }>
    expect(c1.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5])
    expect(c1.map((r) => r.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    const c2 = raw
      .prepare(`SELECT seq FROM chat_messages WHERE conversation_id='c2' ORDER BY seq`)
      .all() as Array<{ seq: number }>
    expect(c2.map((r) => r.seq)).toEqual([1, 2])
  })

  test('sender_character_id is set on assistant messages only', () => {
    const raw = seededThenMigrated()
    const rows = raw
      .prepare(`SELECT role, sender_character_id FROM chat_messages`)
      .all() as Array<{ role: string; sender_character_id: string | null }>
    for (const r of rows) {
      if (r.role === 'assistant') expect(r.sender_character_id).not.toBeNull()
      else expect(r.sender_character_id).toBeNull()
    }
    const c1a = raw
      .prepare(`SELECT sender_character_id FROM chat_messages WHERE id='m1'`)
      .get() as { sender_character_id: string }
    expect(c1a.sender_character_id).toBe('argentina-uncle')
  })

  test('conversation_characters membership rows are created from conversations', () => {
    const raw = seededThenMigrated()
    const rows = raw
      .prepare(`SELECT conversation_id, character_id FROM conversation_characters ORDER BY conversation_id`)
      .all() as Array<{ conversation_id: string; character_id: string }>
    expect(rows).toEqual([
      { conversation_id: 'c1', character_id: 'argentina-uncle' },
      { conversation_id: 'c2', character_id: 'rival-mouth' },
    ])
  })

  test('last_read_seq is backfilled to each conversation max seq', () => {
    const raw = seededThenMigrated()
    const rows = raw
      .prepare(`SELECT id, last_read_seq, type FROM conversations ORDER BY id`)
      .all() as Array<{ id: string; last_read_seq: number; type: string }>
    expect(rows).toEqual([
      { id: 'c1', last_read_seq: 5, type: 'dm' },
      { id: 'c2', last_read_seq: 2, type: 'dm' },
    ])
  })
})
