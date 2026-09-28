import { joinUrl, DEFAULT_TIMEOUT_MS } from './index.js';
function makeHeaders(cfg) {
    return {
        'Content-Type': 'application/json',
        ...cfg.customHeaders,
        'Authorization': cfg.apiKey ? `Bearer ${cfg.apiKey}` : undefined
    };
}
function makeBody(cfg, modelId, prompt, params, stream) {
    const body = {
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        top_p: params.topP,
        stream
    };
    if (cfg?.customBodyTemplate) {
        try {
            const template = cfg.customBodyTemplate;
            const replaced = template
                .replace(/{{prompt}}/g, prompt)
                .replace(/{{model}}/g, modelId)
                .replace(/{{temperature}}/g, String(params.temperature))
                .replace(/{{maxTokens}}/g, String(params.maxTokens))
                .replace(/{{topP}}/g, String(params.topP))
                .replace(/{{stream}}/g, String(stream));
            return JSON.parse(replaced);
        }
        catch { /* fall through to default body */ }
    }
    return body;
}
class CustomProvider {
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
            if (Array.isArray(data?.models))
                return data.models.map((m) => m.id).filter(Boolean);
            return [];
        }
        catch {
            return [];
        }
    }
    async chat(cfg, modelId, prompt, params) {
        const url = joinUrl(cfg.baseUrl, '/v1/chat/completions');
        const body = makeBody(cfg, modelId, prompt, params, false);
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
                const errContent = parsed?.error?.message || parsed?.error || rawText || `HTTP ${res.status}`;
                return {
                    status: res.status,
                    latencyMs,
                    content: '',
                    rawRequest,
                    rawResponse: rawText,
                    error: `HTTP ${res.status}: ${errContent.length > 200 ? errContent.slice(0, 200) + '...' : errContent}`
                };
            }
            let content = '';
            if (parsed?.choices?.[0]?.message?.content)
                content = parsed.choices[0].message.content;
            else if (parsed?.choices?.[0]?.text)
                content = parsed.choices[0].text;
            else if (parsed?.message?.content)
                content = parsed.message.content;
            else if (parsed?.content)
                content = parsed.content;
            else if (parsed?.output)
                content = parsed.output;
            else if (parsed?.response)
                content = parsed.response;
            else
                content = rawText;
            const tokens = parsed?.usage?.total_tokens ??
                (parsed?.usage ? (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0) : undefined);
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
        const url = joinUrl(cfg.baseUrl, '/v1/chat/completions');
        const body = makeBody(cfg, modelId, prompt, params, true);
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
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(':'))
                        continue;
                    if (trimmed.startsWith('data:')) {
                        const data = trimmed.slice(5).trim();
                        if (data === '[DONE]')
                            continue;
                        rawResponse += data + '\n';
                        try {
                            const json = JSON.parse(data);
                            const delta = json?.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                content += delta;
                                yield { delta, done: false };
                            }
                            if (json?.usage?.total_tokens)
                                tokens = json.usage.total_tokens;
                        }
                        catch { /* 非 JSON，跳过 */ }
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
export { CustomProvider };
