import crypto from 'node:crypto';
import { readSettings, writeSettings, hashPassword, verifyPassword } from './storage.js';
import { readConfigs, writeConfigs, encryptApiKey, decryptApiKey } from './storage.js';
class AuthManager {
    sessions = new Set();
    currentPassword = null;
    isInitialized() {
        return readSettings().hasPassword;
    }
    setupPassword(pw) {
        if (pw.length < 4)
            throw new Error('口令至少 4 位');
        const { salt, hash } = hashPassword(pw);
        writeSettings({ hasPassword: true, passwordSalt: salt, passwordHash: hash });
        this.currentPassword = pw;
    }
    unlock(pw) {
        const s = readSettings();
        if (!s.hasPassword)
            return null;
        if (!verifyPassword(pw, s.passwordSalt, s.passwordHash))
            return null;
        this.currentPassword = pw;
        const token = crypto.randomBytes(24).toString('hex');
        this.sessions.add(token);
        return token;
    }
    isUnlocked(token) {
        return !!token && this.sessions.has(token);
    }
    getPassword(token) {
        if (!this.sessions.has(token))
            return null;
        return this.currentPassword;
    }
    logout(token) {
        this.sessions.delete(token);
        // 最后一个会话退出时清掉内存里的口令
        if (this.sessions.size === 0)
            this.currentPassword = null;
    }
    changePassword(oldPw, newPw) {
        const s = readSettings();
        if (!s.hasPassword)
            return false;
        if (!verifyPassword(oldPw, s.passwordSalt, s.passwordHash))
            return false;
        if (newPw.length < 4)
            throw new Error('新口令至少 4 位');
        // 重新加密所有配置的 apiKey
        const configs = readConfigs();
        const reEncrypted = configs.map((cfg) => ({
            ...cfg,
            apiKeyCipher: encryptApiKey(newPw, decryptApiKey(oldPw, cfg.apiKeyCipher)),
            updatedAt: Date.now(),
        }));
        writeConfigs(reEncrypted);
        const { salt, hash } = hashPassword(newPw);
        writeSettings({ hasPassword: true, passwordSalt: salt, passwordHash: hash });
        this.currentPassword = newPw;
        return true;
    }
}
export const auth = new AuthManager();
export async function authGuard(req, reply) {
    const token = req.headers['x-session'] || '';
    if (!auth.isUnlocked(token)) {
        reply.code(401).send({ error: '未解锁或会话已失效' });
    }
}
