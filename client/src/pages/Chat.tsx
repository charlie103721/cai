import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { AppShell } from '@/components/AppShell'
import {
  getConversation,
  streamChatMessage,
  ChatRequestError,
  type ChatMessage,
} from '@/lib/chat'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function Chat() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<{ code: string; text: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const detail = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => getConversation(id),
    enabled: !!id,
  })

  // 服务端历史加载后初始化本地消息列表（之后以本地状态为准做流式追加）
  useEffect(() => {
    if (detail.data) {
      setMessages(
        detail.data.messages.map((m: ChatMessage) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      )
    }
  }, [detail.data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const character = detail.data?.character

  const send = async () => {
    const content = input.trim()
    if (!content || sending) return

    setError(null)
    setSending(true)
    setInput('')

    const assistantId = `pending-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content },
      { id: assistantId, role: 'assistant', content: '' },
    ])

    const appendDelta = (text: string) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)),
      )

    try {
      await streamChatMessage({
        conversationId: id,
        content,
        onDelta: appendDelta,
        onError: (message) => setError({ code: 'STREAM_ERROR', text: message }),
      })
      // 首条消息会生成会话标题，刷新侧边栏
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (err) {
      // 请求没发出去/被拒 — 移除占位的助手消息
      setMessages((prev) => prev.filter((m) => m.id !== assistantId))
      if (err instanceof ChatRequestError && err.code === 'GUEST_LIMIT_REACHED') {
        setError({ code: err.code, text: '免费聊天次数用完啦，注册后可以继续畅聊' })
      } else if (err instanceof ChatRequestError && err.code === 'RATE_LIMITED') {
        setError({ code: err.code, text: '发太快了，休息一下再聊' })
      } else {
        setError({ code: 'REQUEST_FAILED', text: '消息发送失败，请重试' })
        setInput(content)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b p-3 md:px-6">
        <Button variant="ghost" size="sm" className="md:hidden" asChild>
          <Link to="/" aria-label="返回首页">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="text-2xl">{character?.emoji ?? '💬'}</span>
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{character?.name ?? '聊天'}</h1>
          {character && (
            <p className="truncate text-xs text-muted-foreground">{character.tagline}</p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4 md:p-6">
          {detail.isLoading && (
            <p className="text-center text-sm text-muted-foreground">加载中…</p>
          )}
          {detail.isError && (
            <Alert variant="destructive">
              <AlertDescription>会话不存在或已被删除</AlertDescription>
            </Alert>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {m.role === 'assistant' && (
                <span className="shrink-0 text-xl leading-none">{character?.emoji ?? '💬'}</span>
              )}
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm md:max-w-[70%] ${
                  m.role === 'user'
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-muted'
                }`}
              >
                {m.content ||
                  (sending && m.role === 'assistant' ? (
                    <span className="animate-pulse">正在输入…</span>
                  ) : (
                    ''
                  ))}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{error.text}</span>
              {error.code === 'GUEST_LIMIT_REACHED' && (
                <Button size="sm" asChild>
                  <Link to="/signup">免费注册</Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <footer className="border-t p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={`跟${character?.name ?? 'TA'}聊点什么…`}
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-none focus-visible:ring-0"
          />
          <Button onClick={() => void send()} disabled={sending || !input.trim()} size="icon">
            <Send className="size-4" />
          </Button>
        </div>
      </footer>
    </AppShell>
  )
}
