import { sendChatMessage, markConversationRead, type ChatMessage } from './chat'

/**
 * F6 WebSocket 传输层（客户端）。
 *
 * 帧协议与服务端 `server/features/chat/frames.ts` 一致，这里镜像 TS 类型
 * （不直接 import 服务端代码，保持客户端 bundle 干净）。
 *
 * 能力：
 * - 同源 wss `/api/ws` 上连接，指数退避重连（1s→30s 封顶）；
 * - 重连成功后触发 onReconnect（让调用方失效 TanStack 缓存，做一次对账拉取）；
 * - 简单事件订阅 API：on('message' | 'ack' | 'typing' | ...)；
 * - sendMessage / markRead 在 socket 未 OPEN 时回退到 F3 REST 端点。
 */

// ─── 出站帧（client → server）─────────────────────
export interface SendMessageFrame {
  type: 'send_message'
  clientMsgId: string
  conversationId: string
  content: string
}
export interface MarkReadFrame {
  type: 'mark_read'
  conversationId: string
}
export interface PingFrame {
  type: 'ping'
}
export type OutgoingFrame = SendMessageFrame | MarkReadFrame | PingFrame

// ─── 入站帧（server → client）─────────────────────
export interface AckFrame {
  type: 'ack'
  clientMsgId: string
  userMessage: ChatMessage
}
export interface TypingFrame {
  type: 'typing'
  conversationId: string
  on: boolean
}
export interface MessageFrame {
  type: 'message'
  conversationId: string
  message: ChatMessage
}
export interface UnreadUpdateFrame {
  type: 'unread_update'
  conversationId: string
  unread_count: number
}
export interface ErrorFrame {
  type: 'error'
  clientMsgId?: string
  code: string
  /** Seconds until the client may retry — set on RATE_LIMITED (mirrors REST Retry-After). */
  retryAfter?: number
}
export interface PongFrame {
  type: 'pong'
}
export type IncomingFrame =
  | AckFrame
  | TypingFrame
  | MessageFrame
  | UnreadUpdateFrame
  | ErrorFrame
  | PongFrame

type IncomingType = IncomingFrame['type']
type FrameOf<T extends IncomingType> = Extract<IncomingFrame, { type: T }>
type Listener<T extends IncomingType> = (frame: FrameOf<T>) => void

/** sendMessage 结果：socket 走异步帧；REST 回退直接拿到落库行。 */
export type SendResult =
  | { transport: 'socket' }
  | { transport: 'rest'; userMessage: ChatMessage; messages: ChatMessage[] }

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const HEARTBEAT_MS = 25_000

export class WsManager {
  private ws: WebSocket | null = null
  private backoff = INITIAL_BACKOFF_MS
  private running = false
  private hasConnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Map<IncomingType, Set<(frame: IncomingFrame) => void>>()
  private onReconnectCb: (() => void) | null = null

  /** 重连成功回调（首次连接不触发）。 */
  setOnReconnect(cb: (() => void) | null): void {
    this.onReconnectCb = cb
  }

  /** 订阅某类入站帧，返回取消订阅函数。 */
  on<T extends IncomingType>(type: T, cb: Listener<T>): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    const listener = cb as (frame: IncomingFrame) => void
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }

  private emit(frame: IncomingFrame): void {
    const set = this.listeners.get(frame.type)
    if (!set) return
    for (const cb of set) cb(frame)
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.running) return
    this.running = true
    this.open()
  }

  disconnect(): void {
    this.running = false
    this.clearTimers()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }

  private open(): void {
    if (typeof window === 'undefined') return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/api/ws`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.backoff = INITIAL_BACKOFF_MS
      this.startHeartbeat()
      if (this.hasConnected) this.onReconnectCb?.()
      this.hasConnected = true
    }
    ws.onmessage = (ev) => {
      let frame: IncomingFrame
      try {
        frame = JSON.parse(ev.data as string) as IncomingFrame
      } catch {
        return
      }
      this.emit(frame)
    }
    ws.onclose = () => {
      this.stopHeartbeat()
      if (this.running) this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose 会随之触发，重连逻辑集中在 onclose。
      ws.close()
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.running) this.open()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.isOpen) this.rawSend({ type: 'ping' })
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private rawSend(frame: OutgoingFrame): void {
    this.ws?.send(JSON.stringify(frame))
  }

  /**
   * 发消息：socket OPEN 时走帧（ack/typing/message 异步回来）；否则回退 F3 REST，
   * 一次性拿到落库的用户消息 + 回复气泡。
   */
  async sendMessage(
    conversationId: string,
    content: string,
    clientMsgId: string,
  ): Promise<SendResult> {
    if (this.isOpen) {
      this.rawSend({ type: 'send_message', clientMsgId, conversationId, content })
      return { transport: 'socket' }
    }
    const { userMessage, messages } = await sendChatMessage(conversationId, content, clientMsgId)
    return { transport: 'rest', userMessage, messages }
  }

  /** 标记已读：socket OPEN 时走帧；否则回退 F3 REST。 */
  async markRead(conversationId: string): Promise<void> {
    if (this.isOpen) {
      this.rawSend({ type: 'mark_read', conversationId })
      return
    }
    await markConversationRead(conversationId)
  }
}

/** 模块级单例——整个 app 共用一个连接。 */
export const wsManager = new WsManager()
