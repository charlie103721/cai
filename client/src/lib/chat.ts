import { fetchApi } from './api'

/** 聊天/会话里附带的基础角色卡（不含计数）。 */
export interface BasicCharacter {
  id: string
  name: string
  emoji: string
  tagline: string
  greeting: string
}

/** Feed 富集角色：基础卡 + 配色 + 计数/归属（GET /api/characters）。 */
export interface PublicCharacter extends BasicCharacter {
  hue: number
  like_count: number
  liked: boolean
  chat_count: number
  favorited: boolean
}

/** 收藏列表行：基础卡 + hue（GET /api/favorites）。 */
export interface FavoriteCharacter extends BasicCharacter {
  hue: number
}

export interface Conversation {
  id: string
  character_id: string
  title: string | null
  type: string
  topic_id: string | null
  last_read_seq: number
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  seq: number
  sender_character_id: string | null
  kind: string
  status: string
  media_url: string | null
  client_msg_id: string | null
  created_at: string
}

/** 收件箱行的最后一条消息摘要。 */
export interface LastMessage {
  role: string
  content: string
  kind: string
  created_at: string | null
}

/** 收件箱行：会话 + 角色卡 + 最后一条消息 + 未读数。 */
export interface ConversationListItem extends Conversation {
  character: BasicCharacter | null
  last_message: LastMessage | null
  unread_count: number
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

export const getFavorites = () =>
  fetchApi<Envelope<FavoriteCharacter[]>>('/api/favorites').then((r) => r.data)

export const getConversations = () =>
  fetchApi<Envelope<ConversationListItem[]>>('/api/chat/conversations').then((r) => r.data)

export const createConversation = (characterId: string, topicId?: string) =>
  fetchApi<
    Envelope<{
      conversation: Conversation
      messages: ChatMessage[]
      character: BasicCharacter
      reused: boolean
    }>
  >('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ characterId, topicId }),
  }).then((r) => r.data)

export const markConversationRead = (id: string) =>
  fetchApi<Envelope<{ last_read_seq: number }>>(`/api/chat/conversations/${id}/read`, {
    method: 'POST',
  }).then((r) => r.data)

export const getConversation = (id: string) =>
  fetchApi<
    Envelope<{
      conversation: Conversation
      messages: ChatMessage[]
      character: BasicCharacter | null
    }>
  >(`/api/chat/conversations/${id}`).then((r) => r.data)

export const deleteConversation = (id: string) =>
  fetchApi<Envelope<{ deleted: boolean }>>(`/api/chat/conversations/${id}`, {
    method: 'DELETE',
  }).then((r) => r.data)

export class ChatRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

/**
 * 发消息：一次请求，返回持久化后的用户消息 + 助手回复气泡（1..N 条）。
 * 用原始 fetch 以便保留 error code（GUEST_LIMIT_REACHED / RATE_LIMITED / CHAT_UNAVAILABLE）。
 */
export async function sendChatMessage(
  conversationId: string,
  content: string,
  clientMsgId?: string,
): Promise<{ userMessage: ChatMessage; messages: ChatMessage[] }> {
  const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content, clientMsgId }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string }
    } | null
    throw new ChatRequestError(body?.error?.code ?? 'REQUEST_FAILED', res.status)
  }

  const body = (await res.json()) as {
    data: { userMessage: ChatMessage; messages: ChatMessage[] }
  }
  return body.data
}
