import { describe, test, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createMigratedDb } from '../../testutils/db'
import { chat_messages, conversation_characters, daily_topics } from '../../db/schema'
import type { Owner } from '../shared/owner'
import { getCharacter } from '../characters/data'
import {
  createConversationWithGreeting,
  sendMessage,
  buildSystemPrompt,
  splitBubbles,
} from './service'
import { findMessages, findConversation } from './repo'

const guest: Owner = { guestId: 'g1' }
const character = getCharacter('argentina-uncle')!

/** 固定回复的假 LLM，永不触网。 */
const fakeComplete = (text: string) => async () => text
const throwingComplete = async () => {
  throw new Error('llm down')
}

describe('splitBubbles', () => {
  test('no delimiter → one bubble', () => {
    expect(splitBubbles('just one line')).toEqual(['just one line'])
  })
  test('one delimiter → two bubbles, trimmed', () => {
    expect(splitBubbles('a\n---\nb')).toEqual(['a', 'b'])
    expect(splitBubbles('  a  \n---\n  b  ')).toEqual(['a', 'b'])
  })
  test('two delimiters → three bubbles', () => {
    expect(splitBubbles('a\n---\nb\n---\nc')).toEqual(['a', 'b', 'c'])
  })
  test('caps at three bubbles', () => {
    expect(splitBubbles('a\n---\nb\n---\nc\n---\nd')).toEqual(['a', 'b', 'c'])
  })
  test('drops empty segments', () => {
    expect(splitBubbles('a\n---\n\n---\nb')).toEqual(['a', 'b'])
  })
})

describe('createConversationWithGreeting', () => {
  test('greeting seq=1, sender set, read cursor and membership', async () => {
    const { db } = createMigratedDb()
    const { conversation, messages } = await createConversationWithGreeting(db, guest, character)

    expect(conversation.last_read_seq).toBe(1)
    expect(conversation.title).toBeNull()
    expect(messages).toHaveLength(1)
    expect(messages[0].seq).toBe(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].sender_character_id).toBe(character.id)
    expect(messages[0].content).toBe(character.greeting)

    const members = await db
      .select()
      .from(conversation_characters)
      .where(eq(conversation_characters.conversation_id, conversation.id))
    expect(members).toHaveLength(1)
    expect(members[0].character_id).toBe(character.id)
  })

  test('stores topic_id when seeded from a topic', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character, {
      id: 't1',
    })
    expect(conversation.topic_id).toBe('t1')
  })
})

describe('sendMessage', () => {
  test('single bubble: user + one assistant message, consecutive seq', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)

    const { userMessage, messages } = await sendMessage({
      db,
      character,
      conversation,
      content: '你好',
      complete: fakeComplete('嗨小伙子'),
    })

    expect(userMessage.role).toBe('user')
    expect(userMessage.seq).toBe(2) // greeting=1
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].seq).toBe(3)
    expect(messages[0].sender_character_id).toBe(character.id)

    const all = await findMessages(db, conversation.id)
    expect(all.map((m) => m.seq)).toEqual([1, 2, 3])
  })

  test('multi-bubble: N bubbles → N assistant messages with consecutive seq', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)

    const { userMessage, messages } = await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      complete: fakeComplete('一\n---\n二\n---\n三'),
    })

    expect(userMessage.seq).toBe(2)
    expect(messages.map((m) => m.content)).toEqual(['一', '二', '三'])
    expect(messages.map((m) => m.seq)).toEqual([3, 4, 5])
    const all = await findMessages(db, conversation.id)
    expect(all.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
  })

  test('first user message becomes the title (≤30 chars), later ones do not rename', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)

    await sendMessage({ db, character, conversation, content: '第一条消息', complete: fakeComplete('ok') })
    let cv = await findConversation(db, guest, conversation.id)
    expect(cv!.title).toBe('第一条消息')

    // 用最新会话行再发一条，标题不应改变
    await sendMessage({ db, character, conversation: cv!, content: '第二条消息', complete: fakeComplete('ok') })
    cv = await findConversation(db, guest, conversation.id)
    expect(cv!.title).toBe('第一条消息')
  })

  test('LLM failure is atomic — nothing persisted', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)

    await expect(
      sendMessage({ db, character, conversation, content: 'boom', complete: throwingComplete }),
    ).rejects.toThrow()

    const all = await findMessages(db, conversation.id)
    // 只剩开场白，用户消息和回复都没落库
    expect(all).toHaveLength(1)
    expect(all[0].role).toBe('assistant')
  })

  test('clientMsgId replay returns the same rows without a second LLM call', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)
    const clientMsgId = crypto.randomUUID()

    const first = await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      clientMsgId,
      complete: fakeComplete('a\n---\nb'),
    })

    let called = false
    const replay = await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      clientMsgId,
      complete: async () => {
        called = true
        return 'different'
      },
    })

    expect(called).toBe(false)
    expect(replay.userMessage.id).toBe(first.userMessage.id)
    expect(replay.messages.map((m) => m.id)).toEqual(first.messages.map((m) => m.id))
    expect(replay.messages.map((m) => m.content)).toEqual(['a', 'b'])

    // 没有重复落库
    const all = await findMessages(db, conversation.id)
    expect(all).toHaveLength(4) // greeting + user + 2 bubbles
  })

  test('seeded topic is injected into the system prompt', async () => {
    const { db } = createMigratedDb()
    await db.insert(daily_topics).values({
      id: 't1',
      topic_date: '2026-07-11',
      title: '决赛前瞻',
      content: '阿根廷对阵法国',
    })
    const prompt = await buildSystemPrompt(db, character, {
      title: '决赛前瞻',
      content: '阿根廷对阵法国',
    })
    expect(prompt).toContain('【本次对话来源】')
    expect(prompt).toContain('决赛前瞻')
    expect(prompt).toContain('阿根廷对阵法国')
  })

  test('reply turn excludes messages from other turns', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)
    const id1 = crypto.randomUUID()
    await sendMessage({
      db,
      character,
      conversation,
      content: 'turn1',
      clientMsgId: id1,
      complete: fakeComplete('r1a\n---\nr1b'),
    })
    await sendMessage({
      db,
      character,
      conversation,
      content: 'turn2',
      complete: fakeComplete('r2'),
    })

    // 重放第一轮只应拿到第一轮的两条回复
    const replay = await sendMessage({
      db,
      character,
      conversation,
      content: 'turn1',
      clientMsgId: id1,
      complete: throwingComplete,
    })
    expect(replay.messages.map((m) => m.content)).toEqual(['r1a', 'r1b'])
  })
})

describe('unread math via schema columns', () => {
  test('greeting excluded; N bubbles → N unread; read resets to 0', async () => {
    const { db } = createMigratedDb()
    const { conversation } = await createConversationWithGreeting(db, guest, character)

    const unread = async (lastRead: number) => {
      const rows = await db
        .select()
        .from(chat_messages)
        .where(
          and(
            eq(chat_messages.conversation_id, conversation.id),
            eq(chat_messages.role, 'assistant'),
          ),
        )
      return rows.filter((r) => r.seq > lastRead).length
    }

    // greeting is seq=1, last_read_seq=1 → 0 unread
    expect(await unread(conversation.last_read_seq)).toBe(0)

    await sendMessage({
      db,
      character,
      conversation,
      content: 'hi',
      complete: fakeComplete('x\n---\ny'),
    })
    // still reading from the greeting cursor → 2 new assistant bubbles
    expect(await unread(conversation.last_read_seq)).toBe(2)
  })
})
