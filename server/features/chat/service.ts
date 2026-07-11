import type { DB } from '../../db'
import { openChatCompletionStream, type LlmConfig } from '../../lib/llm'
import { SHARED_GUARDRAILS, type Character } from '../characters/data'
import { findActiveTopicsByDate, todayKey } from '../topics/repo'
import {
  insertConversation,
  insertMessage,
  findMessages,
  touchConversation,
  type Owner,
} from './repo'

/** 上下文只带最近 N 条消息，控制 token 成本 */
const CONTEXT_MESSAGE_LIMIT = 30
const MAX_REPLY_TOKENS = 1024
const TITLE_MAX_LENGTH = 30

/** 新会话：落库 + 写入角色开场白，用户进来就有人搭话 */
export async function createConversationWithGreeting(db: DB, owner: Owner, character: Character) {
  const conversation = await insertConversation(db, owner, character.id)
  const greeting = await insertMessage(db, {
    conversation_id: conversation.id,
    role: 'assistant',
    content: character.greeting,
  })
  return { conversation, messages: [greeting] }
}

/** 角色 persona + 共用边界 + 今日话题，拼成 system prompt */
export async function buildSystemPrompt(db: DB, character: Character) {
  const topics = await findActiveTopicsByDate(db, todayKey())

  const topicSection =
    topics.length > 0
      ? `\n\n【今日话题】以下是最近的赛事动态，你已经知道这些信息，聊到相关内容时自然引用，不要机械复述：\n${topics
          .map((t) => `- ${t.title}：${t.content}`)
          .join('\n')}`
      : '\n\n【注意】你目前没有最新赛况信息，聊到具体比赛结果时遵守行为边界里的处理方式。'

  return `你是一个体育球迷聊天应用里的角色，正在和一位球迷用户一对一聊天。\n\n【你的角色】\n${character.persona}\n${SHARED_GUARDRAILS}${topicSection}`
}

/**
 * 发消息主流程：存用户消息 → 组上下文 → 流式请求 LLM（OpenRouter）。
 * 返回文本增量迭代器和一个收尾函数（存助手回复 + 刷新会话）。
 */
export async function streamReply(params: {
  db: DB
  llm: LlmConfig
  character: Character
  conversationId: string
  userContent: string
  isFirstUserMessage: boolean
}) {
  const { db, llm, character, conversationId, userContent, isFirstUserMessage } = params

  await insertMessage(db, {
    conversation_id: conversationId,
    role: 'user',
    content: userContent,
  })

  const history = await findMessages(db, conversationId)
  const context = history.slice(-CONTEXT_MESSAGE_LIMIT)
  const system = await buildSystemPrompt(db, character)

  const stream = await openChatCompletionStream({
    config: llm,
    system,
    maxTokens: MAX_REPLY_TOKENS,
    messages: context.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  })

  const finalize = async (assistantText: string) => {
    if (assistantText.trim()) {
      await insertMessage(db, {
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantText,
      })
    }
    // 首条用户消息兼作会话标题
    const title = isFirstUserMessage ? userContent.slice(0, TITLE_MAX_LENGTH) : undefined
    await touchConversation(db, conversationId, title)
  }

  return { stream, finalize }
}
