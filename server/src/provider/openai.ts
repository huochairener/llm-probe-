import { joinUrl, DEFAULT_TIMEOUT_MS, buildCommonBody } from './index.js'
import type { Provider, DecryptedConfig, TestParams, TestResult, ChatChunk } from './index.js'

function extractContent(obj: any): string | null {
  try {
    if (obj?.choices?.[0]?.message?.content) return obj.choices[0].message.content
    if (typeof obj?.choices?.[0]?.message === 'string') return obj.choices[0].message
    if (obj?.choices?.[0]?.text) return obj.choices[0].text
    if (typeof obj?.message?.content === 'string') return obj.message.content
    if (typeof obj?.message === 'string') return obj.message
    if (typeof obj?.content === 'string') return obj.content
    if (obj?.content?.[0]?.text) return obj.content[0].text
    if (typeof obj?.output === 'string') return obj.output
    if (typeof obj?.response === 'string') return obj.response
  } catch { /* ignore */ }
  return null
}

function makeHeaders(cfg: DecryptedConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`
  }
}

function makeBody(modelId: string, prompt: string, params: TestParams) {
  return {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    ...buildCommonBody(params, params.stream)
  }
}

class OpenAIProvider implements Provider {
  async listModels(cfg: DecryptedConfig): Promise<string[]> {
    try {
      const url = joinUrl(cfg.baseUrl, '/v1/models')
      const res = await fetch(url, {
        method: 'GET',
        headers: makeHeaders(cfg),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return []
      }
      const data = await res.json()
      if (Array.isArray(data?.data)) return data.data.map((m: any) => m.id).filter(Boolean)
      if (Array.isArray(data?.models)) return data.models.map((m: any) => m.id).filter(Boolean)
      return []
    } catch {
      return []
    }
  }

  async chat(cfg: DecryptedConfig, modelId: string, prompt: string, params: TestParams): Promise<TestResult> {
    const url = joinUrl(cfg.baseUrl, '/v1/chat/completions')
    const body = makeBody(modelId, prompt, { ...params, stream: false })
    const rawRequest = JSON.stringify({ url, body })
    const start = Date.now()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: makeHeaders(cfg),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      })
      const latencyMs = Date.now() - start
      const rawText = await res.text()
      let parsed: any
      try { parsed = JSON.parse(rawText) } catch { parsed = null }

      if (!res.ok) {
        const errContent = extractContent(parsed) || rawText || `HTTP ${res.status}`
        return {
          status: res.status,
          latencyMs,
          content: '',
          rawRequest,
          rawResponse: rawText,
          error: `HTTP ${res.status}: ${errContent.length > 200 ? errContent.slice(0, 200) + '...' : errContent}`
        }
      }

      const content = extractContent(parsed) || ''
      const tokens = parsed?.usage?.total_tokens ??
        (parsed?.usage ? parsed.usage.input_tokens + parsed.usage.output_tokens : undefined)

      return {
        status: res.status,
        latencyMs,
        tokens,
        content,
        rawRequest,
        rawResponse: rawText
      }
    } catch (e: any) {
      return {
        status: 0,
        latencyMs: Date.now() - start,
        content: '',
        rawRequest,
        rawResponse: '',
        error: e.message || String(e)
      }
    }
  }

  async *chatStream(cfg: DecryptedConfig, modelId: string, prompt: string, params: TestParams): AsyncGenerator<ChatChunk, void> {
    const url = joinUrl(cfg.baseUrl, '/v1/chat/completions')
    const body = makeBody(modelId, prompt, { ...params, stream: true })
    const rawRequest = JSON.stringify({ url, body })
    const start = Date.now()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: makeHeaders(cfg),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      })

      if (!res.ok) {
        const rawText = await res.text().catch(() => '')
        yield { delta: '', done: true, meta: {
          status: res.status,
          latencyMs: Date.now() - start,
          rawRequest,
          rawResponse: rawText,
          error: `HTTP ${res.status}`
        }}
        return
      }

      let content = ''
      let rawResponse = ''
      let tokens: number | undefined
      let gotError = false

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue
            rawResponse += data + '\n'
            try {
              const json = JSON.parse(data)
              const delta = json?.choices?.[0]?.delta?.content || ''
              if (delta) { content += delta; yield { delta, done: false } }
              if (json?.usage?.total_tokens) tokens = json.usage.total_tokens
            } catch { /* 非 JSON，跳过 */ }
          }
        }
      }

      yield { delta: '', done: true, meta: {
        status: 200,
        latencyMs: Date.now() - start,
        tokens,
        rawRequest,
        rawResponse
      }}
    } catch (e: any) {
      yield { delta: '', done: true, meta: {
        status: 0,
        latencyMs: Date.now() - start,
        rawRequest,
        rawResponse: '',
        error: e.message || String(e)
      }}
    }
  }
}

export { OpenAIProvider, extractContent }
