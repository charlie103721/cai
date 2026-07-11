import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { relTime } from '@/lib/format'
import { unreadLabel } from '@/lib/conversations'
import { getConversations, deleteConversation, type ConversationListItem } from '@/lib/chat'

const MEDIA_PREFIX: Record<string, string> = { image: '[图片] ', video: '[视频] ', audio: '[语音] ' }

function previewText(item: ConversationListItem): string {
  const last = item.last_message
  if (!last) return 'Say hi to start the conversation'
  const prefix = MEDIA_PREFIX[last.kind] ?? ''
  return prefix + (last.content ?? '')
}

function avatarBg(hue: number): string {
  return `radial-gradient(circle at 50% 35%, hsl(${hue} 42% 26%), hsl(${hue} 40% 12%))`
}

/**
 * Inbox — conversation rows from the enriched list (F3 `findConversations`),
 * kept live off the socket by the shell's cache sync. Full-width list on
 * mobile, centered max-640px column on desktop. Tap → chat; kebab / long-press
 * → custom confirm dialog → DELETE the conversation.
 */
export default function ChatsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: getConversations })
  const [pendingDelete, setPendingDelete] = useState<ConversationListItem | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setPendingDelete(null)
    },
    onError: () => toast.error('Could not delete the conversation — please try again.'),
  })

  const rows = (conversations.data ?? [])
    .slice()
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      <div className="mx-auto w-full max-w-[640px] px-3 pb-6 pt-3 lg:px-5 lg:pt-7">
        <div className="px-2 pb-3 text-xl font-extrabold lg:pb-3.5 lg:text-2xl">Chats</div>

        {conversations.isLoading && (
          <p className="px-2 py-8 text-center text-sm text-white/40">Loading…</p>
        )}
        {conversations.isError && (
          <p className="px-2 py-8 text-center text-sm text-white/40">
            Could not load your chats — please try again.
          </p>
        )}
        {!conversations.isLoading && !conversations.isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-8 py-14 text-center">
            <span className="text-4xl">💬</span>
            <p className="max-w-xs text-sm text-white/50">
              No chats yet — start one from the For You feed.
            </p>
          </div>
        )}

        <div className="flex flex-col">
          {rows.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onOpen={() => navigate(`/chat/${item.id}`)}
              onDelete={() => setPendingDelete(item)}
            />
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete conversation?"
        body={
          pendingDelete
            ? `This removes your chat with ${pendingDelete.character?.name ?? 'this character'}. This can’t be undone.`
            : undefined
        }
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function InboxRow({
  item,
  onOpen,
  onDelete,
}: {
  item: ConversationListItem
  onOpen: () => void
  onDelete: () => void
}) {
  const hue = item.character ? hashHue(item.character.id) : 42
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => onDelete(), 550)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  return (
    <div className="group relative flex items-center border-b border-white/[.06]">
      <button
        onClick={onOpen}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        className="flex flex-1 items-center gap-3 py-[11px] pl-2.5 pr-10 text-left lg:gap-3.5 lg:py-3 lg:pl-3"
      >
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-2xl lg:size-[52px] lg:text-[26px]"
          style={{ background: avatarBg(hue) }}
        >
          {item.character?.emoji ?? '💬'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[14.5px] font-semibold lg:text-[15px]">
              {item.character?.name ?? 'Chat'}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-white/40 lg:text-xs">
              {relTime(item.updated_at)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-white/50 lg:text-[13px]">
            {previewText(item)}
          </div>
        </div>
        {item.unread_count > 0 && (
          <span
            aria-label={`${item.unread_count} unread`}
            className="ml-1 shrink-0 rounded-full text-center font-bold"
            style={{
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              lineHeight: '18px',
              fontSize: 11,
              background: 'var(--brand)',
              color: 'var(--brand-foreground)',
            }}
          >
            {unreadLabel(item.unread_count)}
          </span>
        )}
      </button>
      <button
        onClick={onDelete}
        aria-label="Conversation options"
        className="absolute right-1 flex size-8 items-center justify-center rounded-full text-white/40 opacity-0 transition-opacity hover:text-white/80 group-hover:opacity-100 lg:right-1.5"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
    </div>
  )
}

/** Deterministic hue from a character id so inbox avatars stay stable. */
function hashHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}
