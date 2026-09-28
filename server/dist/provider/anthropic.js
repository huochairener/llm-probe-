import { joinUrl, DEFAULT_TIMEOUT_MS } from './index.js';
const ANTHROPIC_VERSION = '2023-06-01';
function makeHeaders(cfg) {
    return {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
    };
}
function makeBody(modelId, prompt, params) {
    return {
        model: modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        top_p: params.topP,
        messages: [{ role: 'user', content: prompt }],
        stream: params.stream
    };
}
class AnthropicProvider {
    async listModels(cfg) {
        try {
            const url = joinUrl(cfg.baseUrl, '/v1/models');
            const res = await fetch(url, {
                method: 'GET',
                headers: makeHeaders(cfg),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
            });
            if (!res.ok)
                return [];
            const data = await res.json();
            if (Array.isArray(data?.data))
                return data.data.map((m) => m.id).filter(Boolean);
            return [];
        }
        catch {
            return [];
        }
    }
    async chat(cfg, modelId, prompt, params) {
        const url = joinUrl(cfg.baseUrl, '/v1/messages');
        const body = makeBody(modelId, prompt, { ...params, stream: false });
        const rawRequest = JSON.stringify({ url, body });
        const start = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: makeHeaders(cfg),
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
            });
            const latencyMs = Date.now() - start;
            const rawText = await res.text();
            let parsed;
            try {
                parsed = JSON.parse(rawText);
            }
            catch {
                parsed = null;
            }
            if (!res.ok) {
                const errContent = parsed?.error?.message || rawText || `HTTP ${res.status}`;
                return {
                    status: res.status,
                    latencyMs,
                    content: '',
                    rawRequest,
                    rawResponse: rawText,
                    error: `HTTP ${res.status}: ${errContent.length > 200 ? errContent.slice(0, 200) + '...' : errContent}`
                };
            }
            const content = parsed?.content?.[0]?.text || '';
            const tokens = parsed?.usage
                ? (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0)
                : undefined;
            return {
                status: res.status,
                latencyMs,
                tokens,
                content,
                rawRequest,
                rawResponse: rawText
            };
        }
        catch (e) {
            return {
                status: 0,
                latencyMs: Date.now() - start,
                content: '',
                rawRequest,
                rawResponse: '',
                error: e.message || String(e)
            };
        }
    }
    async *chatStream(cfg, modelId, prompt, params) {
        const url = joinUrl(cfg.baseUrl, '/v1/messages');
        const body = makeBody(modelId, prompt, { ...params, stream: true });
        const rawRequest = JSON.stringify({ url, body });
        const start = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: makeHeaders(cfg),
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
            });
            if (!res.ok) {
                const rawText = await res.text().catch(() => '');
                yield { delta: '', done: true, meta: {
                        status: res.status,
                        latencyMs: Date.now() - start,
                        rawRequest,
                        rawResponse: rawText,
                        error: `HTTP ${res.status}`
                    } };
                return;
            }
            let content = '';
            let rawResponse = '';
            let tokens;
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let currentEvent = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('event:')) {
                        currentEvent = trimmed.slice(6).trim();
                    }
                    else if (trimmed.startsWith('data:')) {
                        const data = trimmed.slice(5).trim();
                        if (!data)
                            continue;
                        rawResponse += data + '\n';
                        try {
                            const json = JSON.parse(data);
                            if (currentEvent === 'content_block_delta' || json?.type === 'content_block_delta') {
                                const delta = json?.delta?.text || '';
                                if (delta) {
                                    content += delta;
                                    yield { delta, done: false };
                                }
                            }
                            if (json?.type === 'message_start' && json?.message?.usage) {
                                tokens = (json.message.usage.input_tokens || 0) + (json.message.usage.output_tokens || 0);
                            }
                            if (json?.type === 'message_delta' && json?.usage?.output_tokens) {
                                tokens = (tokens || 0) + 0; // 已在上面累加
                            }
                        }
                        catch { /* 非 JSON，跳过 */ }
                    }
                    else if (trimmed === '') {
                        currentEvent = '';
                    }
                }
            }
            yield { delta: '', done: true, meta: {
                    status: 200,
                    latencyMs: Date.now() - start,
                    tokens,
                    rawRequest,
                    rawResponse
                } };
        }
        catch (e) {
            yield { delta: '', done: true, meta: {
                    status: 0,
                    latencyMs: Date.now() - start,
                    rawRequest,
                    rawResponse: '',
                    error: e.message || String(e)
                } };
        }
    }
}
export { AnthropicProvider };
