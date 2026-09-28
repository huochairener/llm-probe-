// 镜像后端类型

export type Protocol = 'openai' | 'anthropic' | 'ollama' | 'custom'

export interface TestParams {
  temperature?: number | null
  maxTokens?: number | null
  topP?: number | null
  stream: boolean
}

export interface Config {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  modelId: string
  prompt: string
  params: TestParams
  customHeaders: Record<string, string>
  customBodyTemplate: string
  createdAt: number
  updatedAt: number
  apiKeyMasked?: string
}

// 配置输入（表单用，apiKey 明文）
export interface ConfigInput {
  name: string
  protocol: Protocol
  baseUrl: string
  apiKey: string
  modelId: string
  prompt: string
  params: TestParams
  customHeaders: Record<string, string>
  customBodyTemplate: string
}

export interface TestResult {
  status: number
  latencyMs: number
  tokens?: number
  content: string
  rawRequest: string
  rawResponse: string
  error?: string
  stream?: boolean
}

export type TabKey = 'single' | 'batch'
