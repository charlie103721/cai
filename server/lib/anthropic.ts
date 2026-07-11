import Anthropic from '@anthropic-ai/sdk'
import type { Context } from 'hono'
import { isDev } from '../config'

/**
 * 每次请求构造客户端（Workers 无跨请求全局状态可依赖）。
 * dev 从 .env（process.env）读，prod 从 Workers secret 绑定读。
 */
export function getAnthropicClient(c: Context<HonoEnv>) {
  const apiKey = isDev ? process.env.ANTHROPIC_API_KEY : c.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  return new Anthropic({ apiKey })
}

/** 对话模型：便宜快的打底，可用环境变量整体切换 */
export function getChatModel(c: Context<HonoEnv>) {
  const configured = isDev ? process.env.ANTHROPIC_MODEL : c.env.ANTHROPIC_MODEL
  return configured || 'claude-haiku-4-5'
}
