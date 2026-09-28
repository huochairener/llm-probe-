import crypto from 'node:crypto'
import { readSettings, writeSettings, hashPassword, verifyPassword } from './storage.js'
import { readConfigs, writeConfigs, encryptApiKey, decryptApiKey, readWebdavConfig, writeWebdavConfig } from './storage.js'
import type { Config } from './storage.js'

class AuthManager {
  private sessions = new Set<string>()
  private currentPassword: string | null = null

  isInitialized() {
    return readSettings().hasPassword
  }

  setupPassword(pw: string) {
    if (pw.length < 4) throw new Error('口令至少 4 位')
    const { salt, hash } = hashPassword(pw)
    writeSettings({ hasPassword: true, passwordSalt: salt, passwordHash: hash })
    this.currentPassword = pw
  }

  unlock(pw: string): string | null {
    const s = readSettings()
    if (!s.hasPassword) return null
    if (!verifyPassword(pw, s.passwordSalt, s.passwordHash)) return null
    this.currentPassword = pw
    const token = crypto.randomBytes(24).toString('hex')
    this.sessions.add(token)
    return token
  }

  isUnlocked(token?: string) {
    return !!token && this.sessions.has(token)
  }

  getPassword(token: string): string | null {
    if (!this.sessions.has(token)) return null
    return this.currentPassword
  }

  logout(token: string) {
    this.sessions.delete(token)
    // 最后一个会话退出时清掉内存里的口令
    if (this.sessions.size === 0) this.currentPassword = null
  }

  changePassword(oldPw: string, newPw: string): boolean {
    const s = readSettings()
    if (!s.hasPassword) return false
    if (!verifyPassword(oldPw, s.passwordSalt, s.passwordHash)) return false
    if (newPw.length < 4) throw new Error('新口令至少 4 位')

    // 重新加密所有配置的 apiKey
    const configs = readConfigs()
    const reEncrypted: Config[] = configs.map((cfg) => ({
      ...cfg,
      apiKeyCipher: encryptApiKey(newPw, decryptApiKey(oldPw, cfg.apiKeyCipher)),
      updatedAt: Date.now(),
    }))
    writeConfigs(reEncrypted)

    // 重加密 webdav.json 的密码（若存在）
    const webdav = readWebdavConfig()
    if (webdav && webdav.passwordCipher) {
      try {
        const plainWdPass = decryptApiKey(oldPw, webdav.passwordCipher)
        writeWebdavConfig({
          ...webdav,
          passwordCipher: encryptApiKey(newPw, plainWdPass),
        })
      } catch {
        // webdav 密文损坏则跳过，不阻断改密
      }
    }

    const { salt, hash } = hashPassword(newPw)
    writeSettings({ hasPassword: true, passwordSalt: salt, passwordHash: hash })
    this.currentPassword = newPw
    return true
  }

  /** 恢复 settings 后调用：清空所有会话与内存口令，强制重登 */
  clearSessions() {
    this.sessions.clear()
    this.currentPassword = null
  }
}

export const auth = new AuthManager()

// Fastify preHandler：校验 x-session
import type { FastifyRequest, FastifyReply } from 'fastify'
export async function authGuard(req: FastifyRequest, reply: FastifyReply) {
  const token = (req.headers['x-session'] as string) || ''
  if (!auth.isUnlocked(token)) {
    reply.code(401).send({ error: '未解锁或会话已失效' })
  }
}
