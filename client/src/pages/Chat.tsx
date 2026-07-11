import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMediaQuery } from 'usehooks-ts'
import { toast } from 'sonner'
import { Verified } from '@/components/Verified'
import { useWs } from '@/hooks/useWs'
import { setActiveChat } from '@/lib/activeChat'
import { zeroConversationUnread } from '@/lib/conversations'
import {
  getConversation,
  favoriteCharacter,
  unfavoriteCharacter,
  ChatRequestError,
  type ChatMessage,
  type ConversationListItem,
  type PublicCharacter,
} from '@/lib/chat'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind: string
  media_url: string | null
  /** Set while a user bubble is optimistic (pre-ack); cleared once persisted. */
  clientMsgId?: string
}

function toDisplay(m: ChatMessage): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    kind: m.kind,
    media_url: m.media_url,
  }
}

const MEDIA_LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频' }

/**
 * Immersive chat — full-screen overlay on mobile, fills the content area beside
 * the sidebar on desktop (messages + composer in a centered max-640px column).
 * Live over the F6 WebSocket: optimistic user bubble keyed by clientMsgId,
 * confirmed by `ack`; typing dots from `typing` frames; each `message` frame
 * appends a bubble (1..N per turn). REST fallback when the socket is down.
 */
export default function Chat() {
  const { conversationId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ws = useWs()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // Local appends: optimistic user bubbles (pre-ack) + assistant bubbles that
  // arrived via `message` frames. Merged over the server truth (query) during
  // render and deduped by id, so a reconnect refetch reconciles automatically.
  const [localMsgs, setLocalMsgs] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [signupPrompt, setSignupPrompt] = useState(false)
  /** null = follow the roster's favorited flag; set once the user toggles. */
  const [favOverride, setFavOverride] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Optimistic bubble content by clientMsgId, so a send error can restore it. */
  const pendingRef = useRef<Map<string, string>>(new Map())

  const detail = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: !!conversationId,
  })

  const character = detail.data?.character
  const characterId = detail.data?.conversation.character_id

  // hue / favorited come from the enriched roster cache when available
  const meta = useMemo(() => {
    const roster = queryClient.getQueryData<PublicCharacter[]>(['characters'])
    return roster?.find((c) => c.id === characterId)
  }, [queryClient, characterId])
  const hue = meta?.hue ?? 42
  const favorited = favOverride ?? meta?.favorited ?? false

  const messages = useMemo<DisplayMessage[]>(() => {
    const server = (detail.data?.messages ?? []).map(toDisplay)
    const serverIds = new Set(server.map((m) => m.id))
    return [...server, ...localMsgs.filter((m) => !serverIds.has(m.id))]
  }, [detail.data, localMsgs])

  // Keep the newest bubble in view.
  useEffect(() => {
    scrollRef.current?.scrollTo?.(0, scrollRef.current.scrollHeight)
  }, [messages, typing])

  // Mark this the active chat (so inbox sync won't bump its unread badge) and
  // clear its unread in the cache immediately on open.
  useEffect(() => {
    if (!conversationId) return
    setActiveChat(conversationId)
    void ws.markRead(conversationId)
    queryClient.setQueryData<ConversationListItem[]>(['conversations'], (old) =>
      zeroConversationUnread(old, conversationId),
    )
    return () => setActiveChat(null)
  }, [conversationId, ws, queryClient])

  const failSend = useCallback((code: string, clientMsgId?: string, retryAfter?: number) => {
    setTyping(false)
    if (clientMsgId) {
      const content = pendingRef.current.get(clientMsgId)
      pendingRef.current.delete(clientMsgId)
      setLocalMsgs((prev) => prev.filter((m) => m.clientMsgId !== clientMsgId))
      if (content) setInput((prev) => prev || content)
    }
    if (code === 'GUEST_LIMIT_REACHED') {
      setSignupPrompt(true)
      return
    }
    if (code === 'RATE_LIMITED') {
      toast.error(
        retryAfter
          ? `Too many messages — try again in ${retryAfter}s.`
          : 'Too many messages — please wait a moment and try again.',
      )
      return
    }
    toast.error('Message failed to send — please retry.')
  }, [])

  // Subscribe to the socket frames for this conversation.
  useEffect(() => {
    if (!conversationId) return
    const offAck = ws.on('ack', (f) => {
      if (f.userMessage.conversation_id !== conversationId) return
      pendingRef.current.delete(f.clientMsgId)
      setLocalMsgs((prev) =>
        prev.map((m) => (m.clientMsgId === f.clientMsgId ? toDisplay(f.userMessage) : m)),
      )
    })
    const offMessage = ws.on('message', (f) => {
      if (f.conversationId !== conversationId) return
      setTyping(false)
      setLocalMsgs((prev) =>
        prev.some((m) => m.id === f.message.id) ? prev : [...prev, toDisplay(f.message)],
      )
      // Frame landed in the open chat → keep it read.
      void ws.markRead(conversationId)
    })
    const offTyping = ws.on('typing', (f) => {
      if (f.conversationId !== conversationId) return
      setTyping(f.on)
    })
    const offError = ws.on('error', (f) => {
      // Only errors tied to one of our optimistic sends concern this view.
      if (!f.clientMsgId || !pendingRef.current.has(f.clientMsgId)) return
      failSend(f.code, f.clientMsgId)
    })
    return () => {
      offAck()
      offMessage()
      offTyping()
      offError()
    }
  }, [conversationId, ws, failSend])

  const send = async () => {
    const content = input.trim()
    if (!content) return
    setInput('')
    setSignupPrompt(false)

    const clientMsgId = crypto.randomUUID()
    pendingRef.current.set(clientMsgId, content)
    setLocalMsgs((prev) => [
      ...prev,
      { id: `pending-${clientMsgId}`, role: 'user', content, kind: 'text', media_url: null, clientMsgId },
    ])

    const willUseSocket = ws.isOpen
    if (!willUseSocket) setTyping(true)

    try {
      const result = await ws.sendMessage(conversationId, content, clientMsgId)
      if (result.transport === 'rest') {
        // REST fallback: user message + all reply bubbles arrive at once.
        pendingRef.current.delete(clientMsgId)
        setTyping(false)
        setLocalMsgs((prev) => {
          const withUser = prev.map((m) =>
            m.clientMsgId === clientMsgId ? toDisplay(result.userMessage) : m,
          )
          const seen = new Set(withUser.map((m) => m.id))
          const appended = result.messages.filter((r) => !seen.has(r.id)).map(toDisplay)
          return [...withUser, ...appended]
        })
        void queryClient.invalidateQueries({ queryKey: ['conversations'] })
        void ws.markRead(conversationId)
      }
      // socket transport: ack / typing / message frames drive the rest.
    } catch (err) {
      const code = err instanceof ChatRequestError ? err.code : 'REQUEST_FAILED'
      const retryAfter = err instanceof ChatRequestError ? err.retryAfterSeconds : undefined
      failSend(code, clientMsgId, retryAfter)
    }
  }

  const toggleFav = async () => {
    if (!characterId) return
    const prev = favorited
    setFavOverride(!prev)
    try {
      const res = prev ? await unfavoriteCharacter(characterId) : await favoriteCharacter(characterId)
      setFavOverride(res.favorited)
    } catch {
      setFavOverride(prev)
      toast.error('Could not update favorites — please try again.')
    }
  }

  const scene = isDesktop
    ? `radial-gradient(90% 50% at 50% 0%, hsl(${hue} 40% 18%) 0%, hsl(${hue} 34% 9%) 50%, #0a0a0c 100%)`
    : `radial-gradient(120% 60% at 50% 12%, hsl(${hue} 44% 22%) 0%, hsl(${hue} 36% 10%) 46%, #0a0a0c 100%)`

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col lg:static lg:z-auto lg:h-full"
      style={{ background: scene }}
    >
      <div className="h-[30px] shrink-0 lg:hidden" />
      <header className="flex flex-none items-center gap-2.5 border-b border-white/10 px-3.5 pb-3 pt-1.5 lg:gap-3 lg:px-[22px] lg:py-4">
        <button onClick={() => navigate(-1)} aria-label="Back" className="flex">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="lg:h-[22px] lg:w-[22px]">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </button>
        <div className="flex size-[38px] items-center justify-center rounded-full border-2 border-white/50 bg-white/15 text-xl lg:size-[42px] lg:text-[22px]">
          {character?.emoji ?? '💬'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-bold lg:text-base">{character?.name ?? 'Chat'}</span>
            <Verified s={12} />
          </div>
          <div className="text-[11px] lg:text-xs" style={{ color: '#7dd0a0' }}>● Online</div>
        </div>
        {characterId && (
          <button
            onClick={() => void toggleFav()}
            aria-label={favorited ? 'Remove favorite' : 'Add favorite'}
            aria-pressed={favorited}
            className="flex size-9 items-center justify-center rounded-full border border-white/15 bg-white/15 text-lg leading-none lg:size-[38px] lg:text-[19px]"
            style={{ color: favorited ? 'var(--brand)' : '#fff' }}
          >
            {favorited ? '★' : '☆'}
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5 lg:gap-4 lg:px-[22px] lg:py-5">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 lg:gap-4">
          {detail.isLoading && <p className="text-center text-sm text-white/50">Loading…</p>}
          {detail.isError && (
            <p className="text-center text-sm text-white/50">This conversation could not be found.</p>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} m={m} emoji={character?.emoji ?? '💬'} />
          ))}
          {typing && (
            <div className="flex items-end gap-2 lg:gap-2.5" style={{ animation: 'rise .3s ease both' }}>
              <span className="text-[22px] leading-none lg:text-2xl">{character?.emoji ?? '💬'}</span>
              <div style={{ padding: '12px 15px', borderRadius: 18, borderBottomLeftRadius: 5, background: 'rgba(255,255,255,.14)' }}>
                <TypingDots />
              </div>
            </div>
          )}
          {signupPrompt && (
            <div className="flex items-end gap-2 lg:gap-2.5" style={{ animation: 'rise .3s ease both' }}>
              <span className="text-[22px] leading-none lg:text-2xl">{character?.emoji ?? '💬'}</span>
              <div
                className="max-w-[76%] px-3.5 py-3 text-sm leading-normal lg:text-[15px]"
                style={{ borderRadius: 18, borderBottomLeftRadius: 5, background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(6px)' }}
              >
                <div className="mb-2 font-semibold">You’ve used up the free chats.</div>
                <div className="mb-2.5 text-white/70">Sign up to keep the conversation going — it’s free.</div>
                <button
                  onClick={() => navigate('/signup')}
                  className="rounded-full px-4 py-1.5 text-[13px] font-bold"
                  style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
                >
                  Sign up
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-none items-center gap-2 px-3.5 pb-4 pt-2.5 lg:px-[22px] lg:pb-5">
        <div className="mx-auto flex w-full max-w-[660px] items-center gap-2 lg:gap-2.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder={`Message ${character?.name ?? ''}…`}
            className="h-11 max-h-28 flex-1 resize-none rounded-full border border-white/15 bg-white/10 px-[18px] py-3 text-sm leading-tight text-white outline-none focus-visible:ring-0 lg:h-12 lg:px-5 lg:text-[15px]"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim()}
            aria-label="Send"
            className="flex size-11 flex-none items-center justify-center rounded-full transition-opacity lg:size-12"
            style={{ background: 'var(--brand)', color: 'var(--brand-foreground)', opacity: input.trim() ? 1 : 0.45 }}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="lg:h-[18px] lg:w-[18px]">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  )
}

function Bubble({ m, emoji }: { m: DisplayMessage; emoji: string }) {
  const u = m.role === 'user'
  return (
    <div
      className={`flex items-end gap-2 lg:gap-2.5 ${u ? 'flex-row-reverse' : ''}`}
      style={{ animation: 'rise .3s ease both' }}
    >
      {!u && <span className="shrink-0 text-[22px] leading-none lg:text-2xl">{emoji}</span>}
      <div
        className="max-w-[76%] whitespace-pre-wrap px-3.5 py-2.5 text-sm leading-normal lg:max-w-[72%] lg:px-4 lg:py-[11px] lg:text-[15px]"
        style={{
          borderRadius: 18,
          backdropFilter: 'blur(6px)',
          background: u ? 'var(--brand)' : 'rgba(255,255,255,.14)',
          color: u ? 'var(--brand-foreground)' : '#fff',
          borderBottomRightRadius: u ? 5 : 18,
          borderBottomLeftRadius: u ? 18 : 5,
          boxShadow: '0 2px 12px rgba(0,0,0,.2)',
        }}
      >
        {m.kind !== 'text' ? <MediaPlaceholder kind={m.kind} content={m.content} /> : m.content}
      </div>
    </div>
  )
}

/** Placeholder card for non-text message kinds (media pipeline is post-roadmap). */
function MediaPlaceholder({ kind, content }: { kind: string; content: string }) {
  const label = MEDIA_LABEL[kind] ?? kind
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-2 rounded-xl border border-dashed border-white/25 px-3 py-4 text-white/70"
        style={{ minWidth: 140 }}
      >
        <span className="text-lg">🖼️</span>
        <span className="text-[13px] font-medium">[{label}]</span>
      </div>
      {content && <span className="text-[13px] text-white/80">{content}</span>}
    </div>
  )
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 16 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ width: 6, height: 6, borderRadius: '9999px', background: '#fff', animation: 'blink 1.2s infinite', animationDelay: i * 0.18 + 's' }}
        />
      ))}
    </span>
  )
}
