import type { FastifyInstance } from 'fastify'
import { auth, authGuard } from './auth.js'
import { listConfigs, createConfig, updateConfig, deleteConfig, getRevealApiKey, getDecryptedConfig } from './config.js'
import { auth as authMgr } from './auth.js'
import { getProvider } from './provider/index.js'
import { runSingleTest, runBatchTest } from './test-runner.js'
import { readWebdavConfig, writeWebdavConfig, getDecryptedWebdavPassword, encryptApiKey } from './storage.js'
import { testConnection, doBackup, doRestore } from './sync.js'
import type { WebdavConfig } from './storage.js'

export async function registerRoutes(app: FastifyInstance) {
  // ---- 健康检查 ----
  app.get('/api/health', () => ({ ok: true }))

  // ---- WebDAV 同步 ----
  app.get('/api/sync/status', async () => {
    const wd = readWebdavConfig()
    if (!wd) return { configured: false }
    return { configured: true, url: wd.url, username: wd.username }
  })

  app.put('/api/sync/config', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const { url, username, password: wdPassword } = req.body as any
    if (!url || !username || !wdPassword) {
      return reply.code(400).send({ error: '缺少 url / username / password' })
    }
    try {
      const cfg: WebdavConfig = {
        url,
        username,
        passwordCipher: encryptApiKey(password, wdPassword),
      }
      writeWebdavConfig(cfg)
      return { ok: true }
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || String(e) })
    }
  })

  app.post('/api/sync/test', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const wd = readWebdavConfig()
    if (!wd) return reply.code(400).send({ error: '尚未配置 WebDAV 凭据' })

    const wdPassword = getDecryptedWebdavPassword(password)
    if (wdPassword === null) return reply.code(500).send({ error: 'WebDAV 密码解密失败' })

    try {
      await testConnection(wd, wdPassword)
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message || String(e) })
    }
  })

  app.post('/api/sync/backup', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const wd = readWebdavConfig()
    if (!wd) return reply.code(400).send({ error: '尚未配置 WebDAV 凭据' })

    const wdPassword = getDecryptedWebdavPassword(password)
    if (wdPassword === null) return reply.code(500).send({ error: 'WebDAV 密码解密失败' })

    try {
      const result = await doBackup(wd, wdPassword)
      return result
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || String(e) })
    }
  })

  app.post('/api/sync/restore', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const wd = readWebdavConfig()
    if (!wd) return reply.code(400).send({ error: '尚未配置 WebDAV 凭据' })

    const wdPassword = getDecryptedWebdavPassword(password)
    if (wdPassword === null) return reply.code(500).send({ error: 'WebDAV 密码解密失败' })

    try {
      const result = await doRestore(wd, wdPassword)
      // settings 已被覆盖，清空所有会话强制重登
      auth.clearSessions()
      return result
    } catch (e: any) {
      return reply.code(400).send({ error: e.message || String(e) })
    }
  })

  // ---- 认证 ----
  app.get('/api/auth/status', () => ({
    initialized: auth.isInitialized()
  }))

  app.post('/api/auth/setup', async (req, reply) => {
    if (auth.isInitialized()) {
      return reply.code(400).send({ error: '已设置口令，请直接解锁' })
    }
    const { password } = req.body as { password?: string }
    if (!password) return reply.code(400).send({ error: '缺少 password' })
    try {
      auth.setupPassword(password)
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  app.post('/api/auth/unlock', async (req, reply) => {
    const { password } = req.body as { password?: string }
    if (!password) return reply.code(400).send({ error: '缺少 password' })
    const token = auth.unlock(password)
    if (!token) return reply.code(401).send({ error: '口令错误' })
    return { token }
  })

  app.post('/api/auth/logout', { preHandler: authGuard }, async (req) => {
    const token = (req.headers['x-session'] as string) || ''
    auth.logout(token)
    return { ok: true }
  })

  app.post('/api/auth/change-password', { preHandler: authGuard }, async (req, reply) => {
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string }
    if (!oldPassword || !newPassword) return reply.code(400).send({ error: '缺少参数' })
    const token = (req.headers['x-session'] as string) || ''
    const password = auth.getPassword(token)
    if (!password || password !== oldPassword) {
      return reply.code(401).send({ error: '原口令错误' })
    }
    try {
      const ok = auth.changePassword(oldPassword, newPassword)
      if (!ok) return reply.code(500).send({ error: '修改失败' })
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  // ---- 配置 CRUD ----
  app.get('/api/configs', { preHandler: authGuard }, async () => {
    return { list: listConfigs() }
  })

  app.post('/api/configs', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })
    const input = req.body as any
    if (!input?.name || !input?.baseUrl || !input?.apiKey) {
      return reply.code(400).send({ error: '缺少必填字段（name/baseUrl/apiKey）' })
    }
    const id = createConfig(input, password)
    return { id }
  })

  app.put('/api/configs/:id', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })
    const { id } = req.params as { id: string }
    const input = req.body as any
    const ok = updateConfig(id, input, password)
    if (!ok) return reply.code(404).send({ error: '配置不存在' })
    return { ok: true }
  })

  app.delete('/api/configs/:id', { preHandler: authGuard }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = deleteConfig(id)
    if (!ok) return reply.code(404).send({ error: '配置不存在' })
    return { ok: true }
  })

  app.get('/api/configs/:id/reveal', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })
    const { id } = req.params as { id: string }
    const apiKey = getRevealApiKey(id, password)
    if (apiKey === null) return reply.code(404).send({ error: '配置不存在' })
    return { apiKey }
  })

  // ---- 模型列表 ----
  app.get('/api/models', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const { configId } = req.query as { configId?: string }
    if (!configId) return reply.code(400).send({ error: '缺少 configId' })

    const cfg = getDecryptedConfig(configId, password)
    if (!cfg) return reply.code(404).send({ error: '配置不存在' })

    try {
      const provider = getProvider(cfg.protocol)
      const models = await provider.listModels(cfg)
      return { models }
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || String(e) })
    }
  })

  // ---- 单模型测试（SSE）----
  app.post('/api/test/single', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const { configId, modelId, prompt, params } = req.body as any
    if (!configId || !modelId) return reply.code(400).send({ error: '缺少 configId 或 modelId' })

    // SSE 头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    reply.hijack()

    const sendEvent = (event: string, data: any) => {
      if (reply.raw.writable) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
    }

    try {
      await runSingleTest(configId, modelId, prompt || 'hi', params, password, sendEvent)
    } catch (e: any) {
      sendEvent('error', { message: e.message || String(e) })
    } finally {
      reply.raw.end()
    }
  })

  // ---- 批量测试（SSE）----
  app.post('/api/batch', { preHandler: authGuard }, async (req, reply) => {
    const token = (req.headers['x-session'] as string) || ''
    const password = authMgr.getPassword(token)
    if (!password) return reply.code(401).send({ error: '会话失效' })

    const { configId, modelIds, prompt, params, concurrency } = req.body as any
    if (!configId || !modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
      return reply.code(400).send({ error: '缺少 configId 或 modelIds' })
    }

    // SSE 头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    reply.hijack()

    const sendEvent = (event: string, data: any) => {
      if (reply.raw.writable) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
    }

    try {
      await runBatchTest(configId, modelIds, prompt || 'hi', params, concurrency || 5, password, sendEvent)
    } catch (e: any) {
      sendEvent('error', { message: e.message || String(e) })
    } finally {
      reply.raw.end()
    }
  })
}
