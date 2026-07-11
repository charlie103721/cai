/**
 * Module-level signal for the currently-open conversation id.
 *
 * The inbox/badge cache-sync effect (mounted once in the shell) reads this to
 * decide whether an incoming `message` frame should bump a conversation's
 * unread count: frames that land in the chat the user is already looking at are
 * marked read, so they must NOT increment the badge.
 */
let active: string | null = null

export function setActiveChat(id: string | null): void {
  active = id
}

export function getActiveChat(): string | null {
  return active
}
