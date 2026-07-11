import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { DB } from '../db'
import { getCharacter } from '../features/characters/data'
import { getLlmConfigFromEnv, completeChatCompletion } from '../lib/llm'
import { findConversation, markConversationRead, type Owner } from '../features/chat/repo'
import { sendMessage } from '../features/chat/service'
import {
  clientFrameSchema,
  FRAME_ERROR_CODES,
  type ServerFrame,
} from '../features/chat/frames'

const MAX_REPLY_TOKENS = 1024
const RATE_LIMIT_WINDOW_MS = 3_600_000
const GUEST_LIMIT = 15
const USER_LIMIT = 60
const RATE_LIMIT_KEY = 'ratelimit'
/** 每条气泡投递之间的停顿区间（拟人化打字节奏）。 */
const PACING_MIN_MS = 400
const PACING_MAX_MS = 900

/** socket 上存的归属信息（serializeAttachment / hibernation 后还原）。 */
interface SocketAttachment {
  ownerKey: string
  kind: 'user' | 'guest'
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * ConnectionHub —— 每个 owner 一个 Durable Object，负责：
 * - 持有该 owner 的 WebSocket 连接（Hibernation API）；
 * - 收到 send_message：限流 → 加载会话 → 复用 F3 sendMessage 服务一次性落库 →
 *   ack → 拟人化节奏推送 typing/message/typing；
 * - mark_read / ping 就地处理；
 * - /notify：其它 Worker（未来的媒体消费者）把帧推给已连接的 socket。
 *
 * DO 只负责「投递与节奏」，从不自己写库——所有持久化都在 F3 的服务里一次 batch 完成。
 */
export class ConnectionHub extends DurableObject<CloudflareBindings> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname.endsWith('/connect')) {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 })
      }
      const ownerKey = req.headers.get('X-Owner-Key')
      if (!ownerKey) return new Response('Missing owner key', { status: 400 })
      const kind: SocketAttachment['kind'] = ownerKey.startsWith('user:') ? 'user' : 'guest'

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      // Hibernation API：用 acceptWebSocket（不是 ws.accept()），DO 可在空闲时休眠。
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ ownerKey, kind } satisfies SocketAttachment)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname.endsWith('/notify')) {
      // 其它 Worker 推帧的入口（未来媒体消费者用）。没有连接时静默 no-op。
      const body = (await req.json().catch(() => null)) as { frames?: ServerFrame[] } | null
      const frames = body?.frames ?? []
      const sockets = this.ctx.getWebSockets()
      for (const ws of sockets) {
        for (const frame of frames) ws.send(JSON.stringify(frame))
      }
      return Response.json({ delivered: sockets.length })
    }

    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.send(ws, { type: 'error', code: FRAME_ERROR_CODES.INVALID_FRAME })
      return
    }

    const parsed = clientFrameSchema.safeParse(json)
    if (!parsed.success) {
      const clientMsgId =
        json && typeof json === 'object' && 'clientMsgId' in json
          ? String((json as { clientMsgId?: unknown }).clientMsgId)
          : undefined
      this.send(ws, { type: 'error', clientMsgId, code: FRAME_ERROR_CODES.INVALID_FRAME })
      return
    }
    const frame = parsed.data

    if (frame.type === 'ping') {
      this.send(ws, { type: 'pong' })
      return
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    if (!attachment) {
      this.send(ws, { type: 'error', code: FRAME_ERROR_CODES.INVALID_FRAME })
      return
    }
    const owner = ownerFromKey(attachment.ownerKey)
    const db = drizzle(this.env.DB, { schema }) as unknown as DB

    if (frame.type === 'mark_read') {
      const conversation = await findConversation(db, owner, frame.conversationId)
      if (!conversation) {
        this.send(ws, { type: 'error', code: FRAME_ERROR_CODES.CONVERSATION_NOT_FOUND })
        return
      }
      await markConversationRead(db, conversation.id)
      return
    }

    // frame.type === 'send_message'
    await this.handleSendMessage(ws, db, owner, attachment.kind, frame)
  }

  private async handleSendMessage(
    ws: WebSocket,
    db: DB,
    owner: Owner,
    kind: SocketAttachment['kind'],
    frame: { clientMsgId: string; conversationId: string; content: string },
  ): Promise<void> {
    // 限流：滑动窗口计数存在 ctx.storage（DO 单实例，天然一致）。
    const limit = await this.checkRateLimit(kind === 'user' ? USER_LIMIT : GUEST_LIMIT)
    if (!limit.allowed) {
      this.send(ws, {
        type: 'error',
        clientMsgId: frame.clientMsgId,
        // 游客限流是注册引导触发点，客户端按 code 区分文案（同 REST）。
        code:
          kind === 'user'
            ? FRAME_ERROR_CODES.RATE_LIMITED
            : FRAME_ERROR_CODES.GUEST_LIMIT_REACHED,
      })
      return
    }

    const conversation = await findConversation(db, owner, frame.conversationId)
    if (!conversation) {
      this.send(ws, {
        type: 'error',
        clientMsgId: frame.clientMsgId,
        code: FRAME_ERROR_CODES.CONVERSATION_NOT_FOUND,
      })
      return
    }

    const character = getCharacter(conversation.character_id)
    if (!character) {
      this.send(ws, {
        type: 'error',
        clientMsgId: frame.clientMsgId,
        code: FRAME_ERROR_CODES.CHARACTER_NOT_FOUND,
      })
      return
    }

    let result: Awaited<ReturnType<typeof sendMessage>>
    try {
      // 所有行先在 F3 服务里一次 batch 落库（DO 从不自己写库）。
      result = await sendMessage({
        db,
        character,
        conversation,
        content: frame.content,
        clientMsgId: frame.clientMsgId,
        complete: ({ system, messages }) =>
          completeChatCompletion({
            config: getLlmConfigFromEnv(this.env),
            system,
            messages,
            maxTokens: MAX_REPLY_TOKENS,
          }),
      })
    } catch {
      // LLM 失败：F3 语义——什么都没落库；客户端保留输入，重试即普通重发。
      this.send(ws, {
        type: 'error',
        clientMsgId: frame.clientMsgId,
        code: FRAME_ERROR_CODES.CHAT_UNAVAILABLE,
      })
      return
    }

    // 用户消息已持久化 → ack。
    this.send(ws, {
      type: 'ack',
      clientMsgId: frame.clientMsgId,
      userMessage: result.userMessage,
    })

    // 拟人化投递：typing on → 每条气泡带 400-900ms 停顿 → typing off。
    // DO 只给「已落库的帧」排节奏，不改任何库。
    this.send(ws, { type: 'typing', conversationId: conversation.id, on: true })
    for (const message of result.messages) {
      await sleep(this.pacingGapMs())
      this.send(ws, { type: 'message', conversationId: conversation.id, message })
    }
    this.send(ws, { type: 'typing', conversationId: conversation.id, on: false })
  }

  /** 滑动窗口限流：ctx.storage 里存时间戳数组，过滤掉窗口外的。 */
  private async checkRateLimit(
    max: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = Date.now()
    const windowStart = now - RATE_LIMIT_WINDOW_MS
    const stored = (await this.ctx.storage.get<number[]>(RATE_LIMIT_KEY)) ?? []
    const valid = stored.filter((t) => t > windowStart)

    if (valid.length >= max) {
      await this.ctx.storage.put(RATE_LIMIT_KEY, valid)
      const retryAfterMs = valid[0] + RATE_LIMIT_WINDOW_MS - now
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
    }
    valid.push(now)
    await this.ctx.storage.put(RATE_LIMIT_KEY, valid)
    return { allowed: true, retryAfterSeconds: 0 }
  }

  /** 每条气泡之间的停顿；测试可用 WS_PACING_MS 覆写成固定值（0 = 无停顿）。 */
  private pacingGapMs(): number {
    const override = this.env.WS_PACING_MS
    if (override !== undefined && override !== '') {
      const n = Number(override)
      if (Number.isFinite(n)) return n
    }
    return PACING_MIN_MS + Math.floor(Math.random() * (PACING_MAX_MS - PACING_MIN_MS + 1))
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    ws.send(JSON.stringify(frame))
  }
}

/** ownerKey（'user:<id>' | 'guest:<id>'）还原成 Owner。 */
function ownerFromKey(ownerKey: string): Owner {
  const [prefix, ...rest] = ownerKey.split(':')
  const id = rest.join(':')
  return prefix === 'user' ? { userId: id } : { guestId: id }
}
