// 数值为空/非有限时，不发送给上游，避免部分模型只接受固定值（例如 temperature 只能为 1）时 400。
export function setIfPresent(target, key, value) {
    if (typeof value === 'number' && Number.isFinite(value))
        target[key] = value;
}
export function buildCommonBody(params, stream = params.stream) {
    const body = { stream };
    setIfPresent(body, 'temperature', params.temperature);
    setIfPresent(body, 'max_tokens', params.maxTokens);
    setIfPresent(body, 'top_p', params.topP);
    return body;
}
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { CustomProvider } from './custom.js';
const PROVIDERS = {
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    ollama: new OllamaProvider(),
    custom: new CustomProvider()
};
export function getProvider(protocol) {
    const p = PROVIDERS[protocol];
    if (!p)
        throw new Error(`未知协议: ${protocol}`);
    return p;
}
// 工具：拼接 baseUrl 和 path，避免双斜杠
export function joinUrl(baseUrl, path) {
    const b = baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : '/' + path;
    return b + p;
}
// 超时配置
export const DEFAULT_TIMEOUT_MS = 60_000;
export const CONNECT_TIMEOUT_MS = 15_000;
