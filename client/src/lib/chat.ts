import { fetchApi } from './api'

export interface PublicCharacter {
  id: string
  name: string
  emoji: string
  tagline: string
  greeting: string
}

export interface Conversation {
  id: string
  character_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface DailyTopic {
  id: string
  title: string
  content: string
  topic_date: string
}

interface Envelope<T> {
  data: T
}

export const getCharacters = () =>
  fetchApi<Envelope<PublicCharacter[]>>('/api/characters').then((r) => r.data)

export const getTodayTopics = () =>
  fetchApi<Envelope<DailyTopic[]>>('/api/topics/today').then((r) => r.data)

export const getConversations = () =>
  fetchApi<Envelope<(Conversation & { character: PublicCharacter | null })[]>>(
    '/api/chat/conversations',
  ).then((r) => r.data)

export const createConversation = (characterId: string) =>
  fetchApi<
    Envelope<{ conversation: Conversation; messages: ChatMessage[]; character: PublicCharacter }>
  >('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  }).then((r) => r.data)

export const getConversation = (id: string) =>
  fetchApi<
    Envelope<{
      conversation: Conversation
      messages: ChatMessage[]
      character: PublicCharacter | null
    }>
  >(`/api/chat/conversations/${id}`).then((r) => r.data)

export class ChatRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

/**
 * 发消息并消费 SSE 流。事件：delta {text} / done / error {message}。
 */
export async function streamChatMessage(opts: {
  conversationId: string
  content: string
  onDelta: (text: string) => void
  onError: (message: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${opts.conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content: opts.content }),
    signal: opts.signal,
  })

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string }
    } | null
    throw new ChatRequestError(body?.error?.code ?? 'REQUEST_FAILED', res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const dispatch = () => {
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    try {
      const payload = JSON.parse(raw) as { text?: string; message?: string }
      if (eventName === 'delta' && payload.text) opts.onDelta(payload.text)
      else if (eventName === 'error') opts.onError(payload.message ?? '回复失败')
    } catch {
      // 忽略无法解析的心跳/空帧
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)

      if (line === '') {
        dispatch()
        eventName = ''
        dataLines = []
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
  }
  dispatch()
}
