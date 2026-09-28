import pLimit from 'p-limit'
import { getDecryptedConfig } from './config.js'
import { getProvider, type TestParams, type TestResult } from './provider/index.js'

export type EventCallback = (event: string, data: any) => void

const DEFAULT_PARAMS: TestParams = {
  temperature: 1,
  maxTokens: 100,
  topP: null,
  stream: false
}

/** 单模型测试：支持流式和非流式 */
export async function runSingleTest(
  cfgId: string,
  modelId: string,
  prompt: string,
  params: Partial<TestParams> | undefined,
  password: string,
  onEvent: EventCallback
): Promise<void> {
  const cfg = getDecryptedConfig(cfgId, password)
  if (!cfg) {
    onEvent('error', { message: '配置不存在' })
    return
  }

  const provider = getProvider(cfg.protocol)
  const mergedParams: TestParams = { ...DEFAULT_PARAMS, ...params }

  if (mergedParams.stream) {
    // ---- 流式模式 ----
    let content = ''
    try {
      for await (const chunk of provider.chatStream(cfg, modelId, prompt, mergedParams)) {
        content += chunk.delta
        if (!chunk.done) {
          onEvent('chunk', { delta: chunk.delta })
        } else {
          // 最终 chunk，携带 meta
          onEvent('done', {
            status: chunk.meta?.status ?? 200,
            latencyMs: chunk.meta?.latencyMs ?? 0,
            tokens: chunk.meta?.tokens,
            content,
            rawRequest: chunk.meta?.rawRequest ?? '',
            rawResponse: chunk.meta?.rawResponse ?? '',
            error: chunk.meta?.error,
            stream: true
          })
        }
      }
    } catch (e: any) {
      onEvent('error', { message: e.message || String(e), content })
    }
  } else {
    // ---- 非流式模式 ----
    try {
      const result = await provider.chat(cfg, modelId, prompt, mergedParams)
      onEvent('result', result)
    } catch (e: any) {
      onEvent('error', { message: e.message || String(e) })
    }
  }
}

/** 批量测试：并发控制，每个模型独立执行 */
export async function runBatchTest(
  cfgId: string,
  modelIds: string[],
  prompt: string,
  params: Partial<TestParams> | undefined,
  concurrency: number,
  password: string,
  onEvent: EventCallback
): Promise<void> {
  const cfg = getDecryptedConfig(cfgId, password)
  if (!cfg) {
    onEvent('error', { message: '配置不存在' })
    return
  }

  const provider = getProvider(cfg.protocol)
  const mergedParams: TestParams = { ...DEFAULT_PARAMS, ...params, stream: false }
  const limit = pLimit(Math.max(1, Math.min(concurrency, modelIds.length)))

  onEvent('start', { total: modelIds.length, concurrency: limit.concurrency })

  await Promise.all(
    modelIds.map((modelId) =>
      limit(async () => {
        try {
          const result = await provider.chat(cfg, modelId, prompt, mergedParams)
          onEvent('item', { modelId, result })
        } catch (e: any) {
          onEvent('item', {
            modelId,
            result: {
              status: 0,
              latencyMs: 0,
              content: '',
              rawRequest: '',
              rawResponse: '',
              error: e.message || String(e)
            } satisfies TestResult
          })
        }
      })
    )
  )

  onEvent('finished', { total: modelIds.length })
}
