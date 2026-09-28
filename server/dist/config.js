import crypto from 'node:crypto';
import { readConfigs, writeConfigs, encryptApiKey, decryptApiKey } from './storage.js';
/** 列表：apiKey 替换为掩码，不返回密文 */
export function listConfigs() {
    return readConfigs().map(({ apiKeyCipher, ...rest }) => ({
        ...rest,
        apiKeyMasked: '••••••'
    }));
}
export function createConfig(input, password) {
    const list = readConfigs();
    const now = Date.now();
    const cfg = {
        id: crypto.randomUUID(),
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        apiKeyCipher: encryptApiKey(password, input.apiKey),
        modelId: input.modelId,
        prompt: input.prompt,
        params: input.params,
        customHeaders: input.customHeaders,
        customBodyTemplate: input.customBodyTemplate,
        createdAt: now,
        updatedAt: now
    };
    list.push(cfg);
    writeConfigs(list);
    return cfg.id;
}
export function updateConfig(id, input, password) {
    const list = readConfigs();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1)
        return false;
    const old = list[idx];
    const updated = {
        ...old,
        name: input.name ?? old.name,
        protocol: input.protocol ?? old.protocol,
        baseUrl: input.baseUrl ?? old.baseUrl,
        modelId: input.modelId ?? old.modelId,
        prompt: input.prompt ?? old.prompt,
        params: input.params ?? old.params,
        customHeaders: input.customHeaders ?? old.customHeaders,
        customBodyTemplate: input.customBodyTemplate ?? old.customBodyTemplate,
        updatedAt: Date.now()
    };
    // 仅当传入新 apiKey 时才重新加密
    if (input.apiKey) {
        updated.apiKeyCipher = encryptApiKey(password, input.apiKey);
    }
    list[idx] = updated;
    writeConfigs(list);
    return true;
}
export function deleteConfig(id) {
    const list = readConfigs();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length)
        return false;
    writeConfigs(next);
    return true;
}
/** 内部用：解密 apiKey 返回完整配置（给 provider 用） */
export function getDecryptedConfig(id, password) {
    const list = readConfigs();
    const cfg = list.find((c) => c.id === id);
    if (!cfg)
        return null;
    try {
        const apiKey = decryptApiKey(password, cfg.apiKeyCipher);
        const { apiKeyCipher, ...rest } = cfg;
        return { ...rest, apiKey };
    }
    catch {
        return null;
    }
}
/** 编辑回填用：返回解密后的明文 apiKey（仅本地，需鉴权） */
export function getRevealApiKey(id, password) {
    const list = readConfigs();
    const cfg = list.find((c) => c.id === id);
    if (!cfg)
        return null;
    try {
        return decryptApiKey(password, cfg.apiKeyCipher);
    }
    catch {
        return null;
    }
}
