import { joinUrl, DEFAULT_TIMEOUT_MS } from './index.js'
import type { Provider, DecryptedConfig, TestParams, TestResult, ChatChunk } from './index.js'
import { extractContent } from './openai.js'

// Ollama 不需要 apiKey，但接口保持不变
class OllamaProvider implements Provider {
  async listModels(cfg: DecryptedConfig): Promise<string[]> {
    try {
      const url = joinUrl(cfg.baseUrl, '/api/tags')
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      })
      if (!res.ok) return []
      const data = await res.json()
      if (Array.isArray(data?.models)) return data.models.map((m: any) => m.name).filter(Boolean)
      return []
    } catch {
      return []
    }
  }

  async chat(cfg: DecryptedConfig, modelId: string, prompt: string, params: TestParams): Promise<TestResult> {
    const url = joinUrl(cfg.baseUrl, '/api/chat')
    const body = {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: {
        temperature: params.temperature,
        num_predict: params.maxTokens,
        top_p: params.topP
      }
    }
    const rawRequest = JSON.stringify({ url, body })
    const start = Date.now()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      })
      const latencyMs = Date.now() - start
      const rawText = await res.text()
      let parsed: any
      try { parsed = JSON.parse(rawText) } catch { parsed = null }

      if (!res.ok) {
        const errContent = parsed?.error || rawText || `HTTP ${res.status}`
        return {
          status: res.status,
          latencyMs,
          content: '',
          rawRequest,
          rawResponse: rawText,
          error: `HTTP ${res.status}: ${errContent.length > 200 ? errContent.slice(0, 200) + '...' : errContent}`
        }
      }

      const content = parsed?.message?.content || ''
      const tokens = parsed?.eval_count || parsed?.prompt_eval_count || undefined

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
    const url = joinUrl(cfg.baseUrl, '/api/chat')
    const body = {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      options: {
        temperature: params.temperature,
        num_predict: params.maxTokens,
        top_p: params.topP
      }
    }
    const rawRequest = JSON.stringify({ url, body })
    const start = Date.now()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          if (!trimmed) continue
          rawResponse += trimmed + '\n'
          try {
            const json = JSON.parse(trimmed)
            const delta = json?.message?.content || ''
            if (delta) { content += delta; yield { delta, done: false } }
            if (json?.eval_count) tokens = json.eval_count
            if (json?.done === true) {
              // 最终 done 信号
            }
          } catch { /* 非 JSON，跳过 */ }
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

export { OllamaProvider }
