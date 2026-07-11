import type { DB } from '../../db'
import {
  completeChatCompletion,
  type ChatTurn,
  type LlmConfig,
} from '../../lib/llm'
import { SHARED_GUARDRAILS, type Character } from '../characters/data'
import { findActiveTopicsByDate, findTopicById, todayKey } from '../topics/repo'
import {
  conversationInsertQuery,
  memberInsertQuery,
  messageInsertQuery,
  touchConversationQuery,
  findMessages,
  findMessageByClientId,
  findTurnReplies,
  runBatch,
  type ChatMessage,
  type Conversation,
  type Owner,
} from './repo'

/** 上下文只带最近 N 条消息，控制 token 成本 */
const CONTEXT_MESSAGE_LIMIT = 30
const MAX_REPLY_TOKENS = 1024
const TITLE_MAX_LENGTH = 30
/** 一轮回复最多拆几条气泡 */
const MAX_BUBBLES = 3
/** 开场白固定是会话第一条消息 */
const GREETING_SEQ = 1

/** 话题种子（会话来源话题），拼进 system prompt 引导前几轮。 */
export interface SeededTopic {
  title: string
  content: string
}

/** LLM 调用注入点：默认打真实接口，测试传假实现（永不触网）。 */
export type CompleteFn = (args: { system: string; messages: ChatTurn[] }) => Promise<string>

/**
 * 新会话：一次 batch 落库会话 + 角色开场白（seq=1）+ 成员行。
 * 开场白已读（last_read_seq=1，未读数不含开场白）；title 仍为空（首条用户消息命名）。
 */
export async function createConversationWithGreeting(
  db: DB,
  owner: Owner,
  character: Character,
  topic?: { id: string } | null,
): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
  const conversationId = crypto.randomUUID()

  const results = await runBatch(db, [
    conversationInsertQuery(db, owner, character.id, {
      id: conversationId,
      topicId: topic?.id ?? null,
      lastReadSeq: GREETING_SEQ,
    }),
    messageInsertQuery(db, {
      conversationId,
      role: 'assistant',
      content: character.greeting,
      seq: GREETING_SEQ,
      senderCharacterId: character.id,
    }),
    memberInsertQuery(db, conversationId, character.id),
  ])

  const conversation = (results[0] as Conversation[])[0]
  const greeting = (results[1] as ChatMessage[])[0]
  return { conversation, messages: [greeting] }
}

/** 角色 persona + 共用边界 + 今日话题 + （可选）来源话题，拼成 system prompt。 */
export async function buildSystemPrompt(db: DB, character: Character, seededTopic?: SeededTopic) {
  const topics = await findActiveTopicsByDate(db, todayKey())

  const topicSection =
    topics.length > 0
      ? `\n\n【今日话题】以下是最近的赛事动态，你已经知道这些信息，聊到相关内容时自然引用，不要机械复述：\n${topics
          .map((t) => `- ${t.title}：${t.content}`)
          .join('\n')}`
      : '\n\n【注意】你目前没有最新赛况信息，聊到具体比赛结果时遵守行为边界里的处理方式。'

  const seededSection = seededTopic
    ? `\n\n【本次对话来源】用户是从话题「${seededTopic.title}」进入的：${seededTopic.content}——开场和前几轮优先围绕这个话题展开。`
    : ''

  return `你是一个体育球迷聊天应用里的角色，正在和一位球迷用户一对一聊天。\n\n【你的角色】\n${character.persona}\n${SHARED_GUARDRAILS}${topicSection}${seededSection}`
}

/**
 * 把 LLM 回复按单独一行的 `---` 拆成 1-3 条气泡：trim、去空、封顶 3；
 * 没有分隔符 → 一条气泡（优雅兜底）。
 */
export function splitBubbles(text: string): string[] {
  const parts = text
    .split(/\n---\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const capped = parts.slice(0, MAX_BUBBLES)
  return capped.length > 0 ? capped : [text.trim()].filter((p) => p.length > 0)
}

/**
 * 发消息主流程（传输无关，REST 与未来的 socket 共用）：
 * 1. 幂等：clientMsgId 命中已存在的用户消息 → 直接返回该消息 + 这一轮回复，不调 LLM。
 * 2. 内存里组上下文（最近 30 条 + 新消息），不先落库。
 * 3. 调 LLM（可注入的 complete），把回复拆成 1-3 条气泡。
 * 4. 一次 batch 原子落库：用户消息 → 各气泡（seq 内联自增）→ touch 会话（+首条标题）。
 *    LLM 失败 → 抛出，什么都不落库（路由转 503）。
 */
export async function sendMessage(params: {
  db: DB
  llm?: LlmConfig
  character: Character
  conversation: Conversation
  content: string
  clientMsgId?: string
  complete?: CompleteFn
}): Promise<{ userMessage: ChatMessage; messages: ChatMessage[] }> {
  const { db, character, conversation, content, clientMsgId } = params

  // 1. 幂等重放
  if (clientMsgId) {
    const existing = await findMessageByClientId(db, conversation.id, clientMsgId)
    if (existing) {
      const messages = await findTurnReplies(db, conversation.id, existing.seq)
      return { userMessage: existing, messages }
    }
  }

  // 2. 内存里组上下文，不先落库
  const history = await findMessages(db, conversation.id)
  const context = history.slice(-CONTEXT_MESSAGE_LIMIT)
  const seededTopic = conversation.topic_id
    ? await findTopicById(db, conversation.topic_id)
    : null
  const system = await buildSystemPrompt(
    db,
    character,
    seededTopic ? { title: seededTopic.title, content: seededTopic.content } : undefined,
  )

  const messagesForLlm: ChatTurn[] = [
    ...context.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content },
  ]

  // 3. 调 LLM（默认真实接口；LlmConfig 缺失时报错→路由 503）
  const complete: CompleteFn =
    params.complete ??
    (({ system: sys, messages }) => {
      if (!params.llm) throw new Error('LLM config is required to complete a chat')
      return completeChatCompletion({
        config: params.llm,
        system: sys,
        messages,
        maxTokens: MAX_REPLY_TOKENS,
      })
    })

  const replyText = await complete({ system, messages: messagesForLlm })
  const bubbles = splitBubbles(replyText)

  // 4. 原子 batch：用户消息 + 各气泡 + touch（首条用户消息命名会话）
  const title = conversation.title == null ? content.slice(0, TITLE_MAX_LENGTH) : undefined

  const queries = [
    messageInsertQuery(db, {
      conversationId: conversation.id,
      role: 'user',
      content,
      clientMsgId: clientMsgId ?? null,
    }),
    ...bubbles.map((bubble) =>
      messageInsertQuery(db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: bubble,
        senderCharacterId: character.id,
      }),
    ),
    touchConversationQuery(db, conversation.id, title),
  ]

  const results = await runBatch(db, queries)
  const userMessage = (results[0] as ChatMessage[])[0]
  const messages = bubbles.map((_, i) => (results[i + 1] as ChatMessage[])[0])
  return { userMessage, messages }
}
