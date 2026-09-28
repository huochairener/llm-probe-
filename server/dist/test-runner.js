import pLimit from 'p-limit';
import { getDecryptedConfig } from './config.js';
import { getProvider } from './provider/index.js';
const DEFAULT_PARAMS = {
    temperature: 1,
    maxTokens: 100,
    topP: null,
    stream: false
};
/** 单模型测试：支持流式和非流式 */
export async function runSingleTest(cfgId, modelId, prompt, params, password, onEvent) {
    const cfg = getDecryptedConfig(cfgId, password);
    if (!cfg) {
        onEvent('error', { message: '配置不存在' });
        return;
    }
    const provider = getProvider(cfg.protocol);
    const mergedParams = { ...DEFAULT_PARAMS, ...params };
    if (mergedParams.stream) {
        // ---- 流式模式 ----
        let content = '';
        try {
            for await (const chunk of provider.chatStream(cfg, modelId, prompt, mergedParams)) {
                content += chunk.delta;
                if (!chunk.done) {
                    onEvent('chunk', { delta: chunk.delta });
                }
                else {
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
                    });
                }
            }
        }
        catch (e) {
            onEvent('error', { message: e.message || String(e), content });
        }
    }
    else {
        // ---- 非流式模式 ----
        try {
            const result = await provider.chat(cfg, modelId, prompt, mergedParams);
            onEvent('result', result);
        }
        catch (e) {
            onEvent('error', { message: e.message || String(e) });
        }
    }
}
/** 批量测试：并发控制，每个模型独立执行 */
export async function runBatchTest(cfgId, modelIds, prompt, params, concurrency, password, onEvent) {
    const cfg = getDecryptedConfig(cfgId, password);
    if (!cfg) {
        onEvent('error', { message: '配置不存在' });
        return;
    }
    const provider = getProvider(cfg.protocol);
    const mergedParams = { ...DEFAULT_PARAMS, ...params, stream: false };
    const limit = pLimit(Math.max(1, Math.min(concurrency, modelIds.length)));
    onEvent('start', { total: modelIds.length, concurrency: limit.concurrency });
    await Promise.all(modelIds.map((modelId) => limit(async () => {
        try {
            const result = await provider.chat(cfg, modelId, prompt, mergedParams);
            onEvent('item', { modelId, result });
        }
        catch (e) {
            onEvent('item', {
                modelId,
                result: {
                    status: 0,
                    latencyMs: 0,
                    content: '',
                    rawRequest: '',
                    rawResponse: '',
                    error: e.message || String(e)
                }
            });
        }
    })));
    onEvent('finished', { total: modelIds.length });
}
