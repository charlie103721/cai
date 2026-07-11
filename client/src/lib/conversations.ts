import type { ConversationListItem } from './chat'
import type { MessageFrame } from './ws'

/** Sum of unread counts across all conversations (the tab/sidebar badge). */
export function unreadTotal(list: ConversationListItem[] | undefined): number {
  if (!list) return 0
  return list.reduce((sum, c) => sum + (c.unread_count || 0), 0)
}

/** Cap an unread count for badge display (99+). */
export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/**
 * Apply an incoming assistant `message` frame to the cached conversations list,
 * in place (no refetch): refresh `last_message` + `updated_at`, and bump
 * `unread_count` unless this conversation is the one currently open on screen
 * (those frames are marked read immediately, so they must not raise the badge).
 * A conversation not yet in the cache is left untouched — the reconcile fetch
 * on reconnect will pick it up.
 */
export function applyMessageFrame(
  list: ConversationListItem[] | undefined,
  frame: MessageFrame,
  activeConversationId: string | null,
): ConversationListItem[] | undefined {
  if (!list) return list
  return list.map((c) => {
    if (c.id !== frame.conversationId) return c
    const isActive = activeConversationId === frame.conversationId
    return {
      ...c,
      updated_at: frame.message.created_at ?? c.updated_at,
      last_message: {
        role: frame.message.role,
        content: frame.message.content,
        kind: frame.message.kind,
        created_at: frame.message.created_at,
      },
      unread_count: isActive ? 0 : (c.unread_count || 0) + 1,
    }
  })
}

/** Set a conversation's unread count from an `unread_update` frame. */
export function setConversationUnread(
  list: ConversationListItem[] | undefined,
  conversationId: string,
  count: number,
): ConversationListItem[] | undefined {
  if (!list) return list
  return list.map((c) => (c.id === conversationId ? { ...c, unread_count: count } : c))
}

/** Zero a conversation's unread count (on open / mark-read). */
export function zeroConversationUnread(
  list: ConversationListItem[] | undefined,
  conversationId: string,
): ConversationListItem[] | undefined {
  if (!list) return list
  return list.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
}
