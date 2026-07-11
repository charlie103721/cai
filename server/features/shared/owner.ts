import { eq, and, isNull, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

/**
 * 归属：登录用户按 user_id，游客按 guest_id（两者互斥）。
 * 所有 owner-scoped 的表都恰好带一个 user_id / guest_id。
 */
export type Owner = { userId: string } | { guestId: string }

/** 任何带 user_id / guest_id 两列的表都能复用归属过滤。 */
type OwnerScopedTable = {
  user_id: SQLiteColumn
  guest_id: SQLiteColumn
}

/**
 * 按归属过滤：登录用户直接匹配 user_id；游客匹配 guest_id 且要求 user_id 为空
 * ——已被合并（F5）到账号的游客行不再作为游客可见，避免跨归属泄漏。
 */
export function ownerFilter(table: OwnerScopedTable, owner: Owner): SQL {
  return 'userId' in owner
    ? eq(table.user_id, owner.userId)
    : (and(eq(table.guest_id, owner.guestId), isNull(table.user_id)) as SQL)
}

/** 插入 owner-scoped 行时的列值：恰好设置一个 user_id / guest_id。 */
export function ownerColumns(owner: Owner): { user_id: string | null; guest_id: string | null } {
  return {
    user_id: 'userId' in owner ? owner.userId : null,
    guest_id: 'guestId' in owner ? owner.guestId : null,
  }
}
