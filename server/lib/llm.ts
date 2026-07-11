import type { Context } from 'hono'
import { isDev } from '../config'

/**
 * OpenRouter（OpenAI 兼容）聊天引擎。
 * 纯 fetch 实现，Workers 上零依赖；换模型只改 OPENROUTER_MODEL。
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

export interface LlmConfig {
  apiKey: string
  model: string
}

/** LLM 相关的环境变量（Hono Bindings 或 Durable Object 的 env 都满足）。 */
export interface LlmEnv {
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
}

/**
 * 从 env 解析 LLM 配置。F6 的 Durable Object 没有 Hono Context，直接拿 env。
 * dev 下走 process.env（本地不注入 CF bindings）。
 */
export function getLlmConfigFromEnv(env: LlmEnv): LlmConfig {
  const apiKey = isDev ? process.env.OPENROUTER_API_KEY : env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured')

  const model = (isDev ? process.env.OPENROUTER_MODEL : env.OPENROUTER_MODEL) || DEFAULT_MODEL
  return { apiKey, model }
}

/** HTTP 上下文里解析 LLM 配置，薄封装 getLlmConfigFromEnv。 */
export function getLlmConfig(c: Context<HonoEnv>): LlmConfig {
  return getLlmConfigFromEnv(c.env)
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 一次性（非流式）chat completion，返回助手回复文本。
 * fetch 在这里完成，鉴权/配置错误或空回复会直接 throw，调用方好返回 503。
 */
export async function completeChatCompletion(params: {
  config: LlmConfig
  system: string
  messages: ChatTurn[]
  maxTokens: number
}): Promise<string> {
  const { config, system, messages, maxTokens } = params

  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter 的应用归因头（可选，用于其后台统计）
      'X-Title': 'cai-fan-chat',
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter request failed: ${res.status} ${detail.slice(0, 300)}`)
  }

  const json = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
  } | null
  const content = json?.choices?.[0]?.message?.content
  if (!content || !content.trim()) {
    throw new Error('OpenRouter returned an empty completion')
  }
  return content
}
