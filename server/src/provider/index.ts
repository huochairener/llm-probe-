import { Config } from '../storage.js'

export type Protocol = Config['protocol']

export interface TestParams {
  temperature?: number | null
  maxTokens?: number | null
  topP?: number | null
  stream: boolean
}

// 数值为空/非有限时，不发送给上游，避免部分模型只接受固定值（例如 temperature 只能为 1）时 400。
export function setIfPresent(target: Record<string, any>, key: string, value: number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) target[key] = value
}

export function buildCommonBody(params: TestParams, stream = params.stream) {
  const body: Record<string, any> = { stream }
  setIfPresent(body, 'temperature', params.temperature)
  setIfPresent(body, 'max_tokens', params.maxTokens)
  setIfPresent(body, 'top_p', params.topP)
  return body
}

export interface ChatChunk {
  delta: string
  done: boolean
  // 仅 done:true 时携带，便于调用方直接从最后一个 chunk 拿元信息
  meta?: Partial<Pick<TestResult, 'status' | 'latencyMs' | 'tokens' | 'rawRequest' | 'rawResponse' | 'error'>>
}

export interface TestResult {
  status: number
  latencyMs: number
  tokens?: number
  content: string
  rawRequest: string
  rawResponse: string
  error?: string
}

export interface DecryptedConfig extends Omit<Config, 'apiKeyCipher'> {
  apiKey: string
}

export interface Provider {
  listModels(cfg: DecryptedConfig): Promise<string[]>
  chat(cfg: DecryptedConfig, modelId: string, prompt: string, params: TestParams): Promise<TestResult>
  chatStream(
    cfg: DecryptedConfig,
    modelId: string,
    prompt: string,
    params: TestParams
  ): AsyncGenerator<ChatChunk, void>
}

import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { OllamaProvider } from './ollama.js'
import { CustomProvider } from './custom.js'

const PROVIDERS: Record<Protocol, Provider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  ollama: new OllamaProvider(),
  custom: new CustomProvider()
}

export function getProvider(protocol: Protocol): Provider {
  const p = PROVIDERS[protocol]
  if (!p) throw new Error(`未知协议: ${protocol}`)
  return p
}

// 工具：拼接 baseUrl 和 path，避免双斜杠
export function joinUrl(baseUrl: string, path: string) {
  const b = baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : '/' + path
  return b + p
}

// 超时配置
export const DEFAULT_TIMEOUT_MS = 60_000
export const CONNECT_TIMEOUT_MS = 15_000
