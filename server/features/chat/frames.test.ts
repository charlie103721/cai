import { describe, test, expect } from 'vitest'
import {
  clientFrameSchema,
  serverFrameSchema,
  persistedMessageSchema,
} from './frames'

const uuid = '11111111-1111-4111-8111-111111111111'

const persistedRow = {
  id: 'm1',
  conversation_id: 'c1',
  role: 'assistant',
  content: 'hi',
  seq: 3,
  sender_character_id: 'argentina-uncle',
  kind: 'text',
  status: 'complete',
  media_url: null,
  client_msg_id: null,
  created_at: new Date().toISOString(),
}

describe('clientFrameSchema', () => {
  test('accepts send_message with a uuid clientMsgId', () => {
    const parsed = clientFrameSchema.safeParse({
      type: 'send_message',
      clientMsgId: uuid,
      conversationId: 'c1',
      content: 'hello',
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts mark_read and ping', () => {
    expect(clientFrameSchema.safeParse({ type: 'mark_read', conversationId: 'c1' }).success).toBe(
      true,
    )
    expect(clientFrameSchema.safeParse({ type: 'ping' }).success).toBe(true)
  })

  test('rejects send_message with a non-uuid clientMsgId', () => {
    expect(
      clientFrameSchema.safeParse({
        type: 'send_message',
        clientMsgId: 'not-a-uuid',
        conversationId: 'c1',
        content: 'hello',
      }).success,
    ).toBe(false)
  })

  test('rejects empty content and over-long content', () => {
    expect(
      clientFrameSchema.safeParse({
        type: 'send_message',
        clientMsgId: uuid,
        conversationId: 'c1',
        content: '',
      }).success,
    ).toBe(false)
    expect(
      clientFrameSchema.safeParse({
        type: 'send_message',
        clientMsgId: uuid,
        conversationId: 'c1',
        content: 'x'.repeat(2001),
      }).success,
    ).toBe(false)
  })

  test('rejects unknown frame types', () => {
    expect(clientFrameSchema.safeParse({ type: 'ack' }).success).toBe(false)
    expect(clientFrameSchema.safeParse({ type: 'nope' }).success).toBe(false)
    expect(clientFrameSchema.safeParse(null).success).toBe(false)
  })
})

describe('persistedMessageSchema', () => {
  test('accepts a full persisted row (string created_at)', () => {
    expect(persistedMessageSchema.safeParse(persistedRow).success).toBe(true)
  })
  test('accepts a Date created_at (pre-serialization)', () => {
    expect(
      persistedMessageSchema.safeParse({ ...persistedRow, created_at: new Date() }).success,
    ).toBe(true)
  })
})

describe('serverFrameSchema', () => {
  test('accepts ack / typing / message / error / pong / unread_update', () => {
    expect(
      serverFrameSchema.safeParse({ type: 'ack', clientMsgId: uuid, userMessage: persistedRow })
        .success,
    ).toBe(true)
    expect(serverFrameSchema.safeParse({ type: 'typing', conversationId: 'c1', on: true }).success).toBe(
      true,
    )
    expect(
      serverFrameSchema.safeParse({ type: 'message', conversationId: 'c1', message: persistedRow })
        .success,
    ).toBe(true)
    expect(serverFrameSchema.safeParse({ type: 'error', code: 'CHAT_UNAVAILABLE' }).success).toBe(
      true,
    )
    expect(serverFrameSchema.safeParse({ type: 'pong' }).success).toBe(true)
    expect(
      serverFrameSchema.safeParse({ type: 'unread_update', conversationId: 'c1', unread_count: 2 })
        .success,
    ).toBe(true)
  })

  test('error frame allows optional clientMsgId', () => {
    expect(
      serverFrameSchema.safeParse({ type: 'error', clientMsgId: uuid, code: 'RATE_LIMITED' }).success,
    ).toBe(true)
  })
})
