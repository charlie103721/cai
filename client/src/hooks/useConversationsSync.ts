import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWs } from './useWs'
import { getActiveChat } from '@/lib/activeChat'
import { applyMessageFrame, setConversationUnread } from '@/lib/conversations'
import type { ConversationListItem } from '@/lib/chat'

/**
 * Keeps the cached conversations list (inbox rows + tab/sidebar badge) live off
 * the socket, in place — no refetch. Mounted once by the shell so it works
 * regardless of which page is open. `message` frames refresh the row's preview
 * and bump unread (unless the chat is open); `unread_update` frames set the
 * count directly. Frames for the open chat are marked read by Chat itself.
 */
export function useConversationsSync(): void {
  const ws = useWs()
  const queryClient = useQueryClient()

  useEffect(() => {
    const offMessage = ws.on('message', (frame) => {
      queryClient.setQueryData<ConversationListItem[]>(['conversations'], (old) =>
        applyMessageFrame(old, frame, getActiveChat()),
      )
    })
    const offUnread = ws.on('unread_update', (frame) => {
      queryClient.setQueryData<ConversationListItem[]>(['conversations'], (old) =>
        setConversationUnread(old, frame.conversationId, frame.unread_count),
      )
    })
    return () => {
      offMessage()
      offUnread()
    }
  }, [ws, queryClient])
}
