import { describe, it, expect } from 'vitest'
import {
  unreadTotal,
  unreadLabel,
  applyMessageFrame,
  setConversationUnread,
  zeroConversationUnread,
} from './conversations'
import type { ConversationListItem } from './chat'
import type { MessageFrame } from './ws'

function conv(id: string, unread: number): ConversationListItem {
  return {
    id,
    character_id: `char-${id}`,
    title: null,
    type: 'dm',
    topic_id: null,
    last_read_seq: 0,
    created_at: '2026-07-11T10:00:00Z',
    updated_at: '2026-07-11T10:00:00Z',
    character: { id: `char-${id}`, name: id, emoji: '💬', tagline: '', greeting: '' },
    last_message: null,
    unread_count: unread,
  }
}

function messageFrame(conversationId: string): MessageFrame {
  return {
    type: 'message',
    conversationId,
    message: {
      id: `m-${Math.random()}`,
      conversation_id: conversationId,
      role: 'assistant',
      content: 'hello',
      seq: 5,
      sender_character_id: 'char-a',
      kind: 'text',
      status: 'complete',
      media_url: null,
      client_msg_id: null,
      created_at: '2026-07-11T11:00:00Z',
    },
  }
}

describe('unreadTotal (badge sum)', () => {
  it('sums unread counts across conversations', () => {
    expect(unreadTotal([conv('a', 2), conv('b', 0), conv('c', 5)])).toBe(7)
  })
  it('is 0 for empty/undefined', () => {
    expect(unreadTotal([])).toBe(0)
    expect(unreadTotal(undefined)).toBe(0)
  })
})

describe('unreadLabel', () => {
  it('caps at 99+', () => {
    expect(unreadLabel(3)).toBe('3')
    expect(unreadLabel(99)).toBe('99')
    expect(unreadLabel(100)).toBe('99+')
    expect(unreadLabel(2400)).toBe('99+')
  })
})

describe('applyMessageFrame', () => {
  it('bumps unread + refreshes preview for a background conversation', () => {
    const list = [conv('a', 1), conv('b', 0)]
    const next = applyMessageFrame(list, messageFrame('a'), null)!
    expect(next.find((c) => c.id === 'a')!.unread_count).toBe(2)
    expect(next.find((c) => c.id === 'a')!.last_message?.content).toBe('hello')
    expect(next.find((c) => c.id === 'a')!.updated_at).toBe('2026-07-11T11:00:00Z')
    expect(next.find((c) => c.id === 'b')!.unread_count).toBe(0)
  })

  it('does NOT bump unread for the conversation open on screen', () => {
    const list = [conv('a', 3)]
    const next = applyMessageFrame(list, messageFrame('a'), 'a')!
    expect(next[0].unread_count).toBe(0)
    expect(next[0].last_message?.content).toBe('hello')
  })
})

describe('setConversationUnread / zeroConversationUnread', () => {
  it('sets a specific unread count', () => {
    const next = setConversationUnread([conv('a', 3), conv('b', 1)], 'a', 9)!
    expect(next.find((c) => c.id === 'a')!.unread_count).toBe(9)
    expect(next.find((c) => c.id === 'b')!.unread_count).toBe(1)
  })
  it('zeros a conversation on open', () => {
    const next = zeroConversationUnread([conv('a', 3)], 'a')!
    expect(next[0].unread_count).toBe(0)
  })
})
