import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Verified } from '@/components/Verified'
import {
  getConversation,
  sendChatMessage,
  favoriteCharacter,
  unfavoriteCharacter,
  ChatRequestError,
  type ChatMessage,
  type PublicCharacter,
} from '@/lib/chat'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/**
 * Chat surface — full-screen overlay on mobile (covers the tab bar), fills the
 * content area beside the sidebar on desktop. The immersive rebuild (live over
 * the socket, typing dots, etc.) lands in F8; F7 keeps the REST send working
 * inside the new dark shell.
 */
export default function Chat() {
  const { conversationId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<{ code: string; text: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const detail = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: !!conversationId,
  })

  const character = detail.data?.character

  // hue / favorited come from the enriched roster cache when available
  const meta = useMemo(() => {
    const roster = queryClient.getQueryData<PublicCharacter[]>(['characters'])
    return roster?.find((c) => c.id === detail.data?.conversation.character_id)
  }, [queryClient, detail.data])
  const hue = meta?.hue ?? 42
  const [favorited, setFavorited] = useState(false)
  useEffect(() => setFavorited(meta?.favorited ?? false), [meta])

  useEffect(() => {
    if (detail.data) {
      setMessages(
        detail.data.messages.map((m: ChatMessage) => ({ id: m.id, role: m.role, content: m.content })),
      )
    }
  }, [detail.data])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages, sending])

  const toggleFav = async () => {
    if (!meta) return
    const prev = favorited
    setFavorited(!prev)
    try {
      const res = prev ? await unfavoriteCharacter(meta.id) : await favoriteCharacter(meta.id)
      setFavorited(res.favorited)
    } catch {
      setFavorited(prev)
      toast.error('Could not update follow — please try again.')
    }
  }

  const send = async () => {
    const content = input.trim()
    if (!content || sending) return
    setError(null)
    setSending(true)
    setInput('')

    const clientMsgId = crypto.randomUUID()
    const tempUserId = `user-${clientMsgId}`
    setMessages((prev) => [...prev, { id: tempUserId, role: 'user', content }])

    try {
      const { userMessage, messages: replies } = await sendChatMessage(conversationId, content, clientMsgId)
      setMessages((prev) => {
        const withUser = prev.map((m) =>
          m.id === tempUserId ? { id: userMessage.id, role: userMessage.role, content: userMessage.content } : m,
        )
        return [...withUser, ...replies.map((r) => ({ id: r.id, role: r.role, content: r.content }))]
      })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId))
      setInput(content)
      if (err instanceof ChatRequestError && err.code === 'GUEST_LIMIT_REACHED') {
        setError({ code: err.code, text: 'You’ve used up the free chats — sign up to keep going.' })
      } else if (err instanceof ChatRequestError && err.code === 'RATE_LIMITED') {
        setError({ code: err.code, text: 'Slow down a moment, then try again.' })
      } else {
        setError({ code: 'REQUEST_FAILED', text: 'Message failed to send — please retry.' })
      }
    } finally {
      setSending(false)
    }
  }

  const scene = `radial-gradient(120% 60% at 50% 12%, hsl(${hue} 44% 22%) 0%, hsl(${hue} 36% 10%) 46%, #0a0a0c 100%)`

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col lg:static lg:z-auto lg:h-full"
      style={{ background: scene }}
    >
      <div className="h-[30px] shrink-0 lg:hidden" />
      <header className="flex flex-none items-center gap-2.5 border-b border-white/10 px-3.5 pb-3 pt-1.5 lg:px-6 lg:py-4">
        <button onClick={() => navigate(-1)} aria-label="Back" className="flex">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </button>
        <div className="flex size-[38px] items-center justify-center rounded-full border-2 border-white/50 bg-white/15 text-xl">
          {character?.emoji ?? '💬'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-bold">{character?.name ?? 'Chat'}</span>
            <Verified s={12} />
          </div>
          <div className="text-[11px]" style={{ color: '#7dd0a0' }}>● Online</div>
        </div>
        {meta && (
          <button
            onClick={() => void toggleFav()}
            aria-label="Favorite"
            className="flex size-9 items-center justify-center rounded-full border border-white/15 bg-white/15 text-lg leading-none"
            style={{ color: favorited ? 'var(--brand)' : '#fff' }}
          >
            {favorited ? '★' : '☆'}
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5 lg:px-6">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5">
          {detail.isLoading && <p className="text-center text-sm text-white/50">Loading…</p>}
          {detail.isError && (
            <p className="text-center text-sm text-white/50">This conversation could not be found.</p>
          )}
          {messages.map((m) => {
            const u = m.role === 'user'
            return (
              <div key={m.id} className={`flex items-end gap-2 ${u ? 'flex-row-reverse' : ''}`} style={{ animation: 'rise .3s ease both' }}>
                {!u && <span className="shrink-0 text-[22px] leading-none">{character?.emoji ?? '💬'}</span>}
                <div
                  className="max-w-[76%] whitespace-pre-wrap px-3.5 py-2.5 text-sm leading-normal"
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
                  {m.content}
                </div>
              </div>
            )
          })}
          {sending && (
            <div className="flex items-end gap-2" style={{ animation: 'rise .3s ease both' }}>
              <span className="text-[22px] leading-none">{character?.emoji ?? '💬'}</span>
              <div style={{ padding: '12px 15px', borderRadius: 18, borderBottomLeftRadius: 5, background: 'rgba(255,255,255,.14)' }}>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 16 }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '9999px', background: '#fff', animation: 'blink 1.2s infinite', animationDelay: i * 0.18 + 's' }} />
                  ))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-auto w-full max-w-[640px] px-4 pb-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-sm">
            <span>{error.text}</span>
            {error.code === 'GUEST_LIMIT_REACHED' && (
              <button
                onClick={() => navigate('/signup')}
                className="rounded-full px-3 py-1 text-[13px] font-semibold"
                style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
              >
                Sign up
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="flex flex-none items-center gap-2 px-3.5 pb-4 pt-2.5 lg:px-6">
        <div className="mx-auto flex w-full max-w-[660px] items-center gap-2">
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
            className="h-11 max-h-28 flex-1 resize-none rounded-full border border-white/15 bg-white/10 px-4.5 py-3 text-sm leading-tight text-white outline-none focus-visible:ring-0"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            aria-label="Send"
            className="flex size-11 flex-none items-center justify-center rounded-full transition-opacity"
            style={{ background: 'var(--brand)', color: 'var(--brand-foreground)', opacity: input.trim() && !sending ? 1 : 0.45 }}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  )
}
