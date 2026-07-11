import { z } from 'zod'

/**
 * WebSocket 帧协议（F6）。JSON，按 `type` 区分。
 *
 * 设计原则：没有"回复"这种帧——一轮用户消息产生 0..N 条 `message` 帧，
 * 每条都是一条完整的、已持久化的消息行（多气泡、未来的媒体完成、未来的主动
 * 推送都是同一种 `message` 帧）。D1 是唯一真相，socket 只负责投递。
 *
 * 这里的 Zod schema 在服务端（Durable Object 解析入站帧）与客户端（镜像类型）
 * 之间共享形状；客户端在 `client/src/lib/ws.ts` 里镜像同样的 TS 类型。
 */

/** 已持久化的消息行（`ack.userMessage` / `message.message` 里的整行）。 */
export const persistedMessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.string(),
  content: z.string(),
  seq: z.number(),
  sender_character_id: z.string().nullable(),
  kind: z.string(),
  status: z.string(),
  media_url: z.string().nullable(),
  client_msg_id: z.string().nullable(),
  // 落库时是 Date（drizzle timestamp），JSON 序列化后是 ISO 字符串——两者都接受。
  created_at: z.union([z.string(), z.date(), z.number()]),
})
export type PersistedMessage = z.infer<typeof persistedMessageSchema>

// ─── 客户端 → 服务端 ─────────────────────────────

export const sendMessageFrameSchema = z.object({
  type: z.literal('send_message'),
  clientMsgId: z.string().uuid(),
  conversationId: z.string().min(1),
  content: z.string().min(1).max(2000),
})

export const markReadFrameSchema = z.object({
  type: z.literal('mark_read'),
  conversationId: z.string().min(1),
})

export const pingFrameSchema = z.object({
  type: z.literal('ping'),
})

/** 入站帧（DO 用它解析 raw；解析失败 → error 帧）。 */
export const clientFrameSchema = z.discriminatedUnion('type', [
  sendMessageFrameSchema,
  markReadFrameSchema,
  pingFrameSchema,
])
export type ClientFrame = z.infer<typeof clientFrameSchema>

// ─── 服务端 → 客户端 ─────────────────────────────

export const ackFrameSchema = z.object({
  type: z.literal('ack'),
  clientMsgId: z.string(),
  userMessage: persistedMessageSchema,
})

export const typingFrameSchema = z.object({
  type: z.literal('typing'),
  conversationId: z.string(),
  on: z.boolean(),
})

export const messageFrameSchema = z.object({
  type: z.literal('message'),
  conversationId: z.string(),
  message: persistedMessageSchema,
})

/** 预留：由 /notify 推送（未读数变化，媒体消费者等其它 Worker 用）。 */
export const unreadUpdateFrameSchema = z.object({
  type: z.literal('unread_update'),
  conversationId: z.string(),
  unread_count: z.number(),
})

export const errorFrameSchema = z.object({
  type: z.literal('error'),
  clientMsgId: z.string().optional(),
  code: z.string(),
})

export const pongFrameSchema = z.object({
  type: z.literal('pong'),
})

/** 出站帧（供测试校验形状；DO 发送前构造这些对象）。 */
export const serverFrameSchema = z.discriminatedUnion('type', [
  ackFrameSchema,
  typingFrameSchema,
  messageFrameSchema,
  unreadUpdateFrameSchema,
  errorFrameSchema,
  pongFrameSchema,
])
export type ServerFrame = z.infer<typeof serverFrameSchema>

/** 帧错误码（与 REST 一致，客户端按 code 区分文案）。 */
export const FRAME_ERROR_CODES = {
  INVALID_FRAME: 'INVALID_FRAME',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CHARACTER_NOT_FOUND: 'CHARACTER_NOT_FOUND',
  CHAT_UNAVAILABLE: 'CHAT_UNAVAILABLE',
  GUEST_LIMIT_REACHED: 'GUEST_LIMIT_REACHED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const
