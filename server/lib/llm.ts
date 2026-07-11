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

export function getLlmConfig(c: Context<HonoEnv>): LlmConfig {
  const apiKey = isDev ? process.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured')

  const model = (isDev ? process.env.OPENROUTER_MODEL : c.env.OPENROUTER_MODEL) || DEFAULT_MODEL
  return { apiKey, model }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 发起流式 chat completion，返回文本增量的异步迭代器。
 * fetch 在这里就完成，鉴权/配置错误会直接 throw，调用方好返回 503。
 */
export async function openChatCompletionStream(params: {
  config: LlmConfig
  system: string
  messages: ChatTurn[]
  maxTokens: number
}): Promise<AsyncGenerator<string>> {
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
      stream: true,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter request failed: ${res.status} ${detail.slice(0, 300)}`)
  }

  return parseSseTextDeltas(res.body)
}

/** 解析 OpenAI 风格 SSE：data: {choices:[{delta:{content}}]} / data: [DONE] */
async function* parseSseTextDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '').trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return

        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[]
            error?: { message?: string }
          }
          if (json.error) throw new Error(`OpenRouter stream error: ${json.error.message}`)
          const text = json.choices?.[0]?.delta?.content
          if (text) yield text
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('OpenRouter stream error')) throw err
          // 其余解析失败的行（注释/心跳）直接忽略
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
