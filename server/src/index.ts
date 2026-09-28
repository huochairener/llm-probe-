import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { isSea } from 'node:sea'
import { registerRoutes } from './routes.js'
import { ensureDataDir, readSeaAsset } from './storage.js'
import { getProvider, type DecryptedConfig, type Protocol } from './provider/index.js'

// esbuild 打包成 CJS 后 import.meta.url 会变成 undefined，这里兜底
const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
})()
const isSeaNow = isSea()
// SEA 单文件 exe 永远按生产模式跑（双击时没有 NODE_ENV）
const isProd = process.env.NODE_ENV === 'production' || isSeaNow

// 简单 MIME 表（SEA 模式下手动服务静态文件用）
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

const app = Fastify({ logger: isSeaNow ? { level: 'warn' } : true })

// 数据目录确保存在
ensureDataDir()

// 开发探针路由：直接测试 provider，不需要保存配置或认证
app.post('/api/dev/probe', async (req, reply) => {
  if (isProd) {
    return reply.code(404).send({ error: 'Not found' })
  }

  const { protocol, baseUrl, apiKey, modelId, prompt, params } = req.body as any

  if (!protocol || !baseUrl || !modelId) {
    return reply.code(400).send({ error: '缺少必填参数: protocol, baseUrl, modelId' })
  }

  try {
    const provider = getProvider(protocol as Protocol)
    const cfg: DecryptedConfig = {
      id: 'dev-probe',
      name: 'dev-probe',
      protocol: protocol as Protocol,
      baseUrl,
      apiKey: apiKey || '',
      modelId,
      prompt: prompt || 'hi',
      params: params || { temperature: 0.7, maxTokens: 100, topP: 0.9, stream: false },
      customHeaders: {},
      customBodyTemplate: '',
      createdAt: 0,
      updatedAt: 0
    }

    const result = await provider.chat(
      cfg,
      modelId,
      prompt || 'hi',
      params || { temperature: 0.7, maxTokens: 100, topP: 0.9, stream: false }
    )
    return result
  } catch (e: any) {
    return reply.code(500).send({ error: e.message || String(e) })
  }
})

// 生产模式：服务前端静态文件
if (isProd) {
  if (isSeaNow) {
    // SEA 模式：从内嵌资源手动服务前端
    const serveAsset = (urlPath: string, reply: any): boolean => {
      // 去掉 querystring，去掉开头的 /
      const clean = urlPath.split('?')[0].replace(/^\/+/, '')
      const key = clean === '' ? 'index.html' : clean
      const buf = readSeaAsset('web/' + key)
      if (buf) {
        const ext = path.extname(key).toLowerCase()
        reply.type(MIME[ext] || 'application/octet-stream')
        reply.send(buf)
        return true
      }
      return false
    }

    app.setNotFoundHandler((req, reply) => {
      const url = req.url || '/'
      if (url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not found' })
        return
      }
      if (!serveAsset(url, reply)) {
        // SPA fallback 到 index.html
        if (!serveAsset('/', reply)) {
          reply.code(404).send({ error: 'index.html not found in SEA assets' })
        }
      }
    })
  } else {
    // 常规 Node 生产模式：从磁盘服务 web/dist
    const webDist = path.join(__dirname, '..', '..', 'web', 'dist')
    app.register(fastifyStatic, {
      root: webDist,
      prefix: '/'
    })
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not found' })
      } else {
        reply.sendFile('index.html')
      }
    })
  }
}

// 端口被占用时自动顺延，保证双击 exe 一定能起来
async function listenWithFallback(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    try {
      await app.listen({ port, host: '127.0.0.1' })
      return port
    } catch (e: any) {
      if (e?.code !== 'EADDRINUSE') throw e
      app.log.warn(`端口 ${port} 被占用，尝试 ${port + 1}`)
    }
  }
  throw new Error(`端口 ${startPort}-${startPort + 19} 全部被占用`)
}

function openBrowser(url: string) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch { /* 打不开浏览器不影响服务 */ }
}

async function main() {
  await registerRoutes(app)
  const startPort = Number(process.env.PORT) || 3173
  const port = await listenWithFallback(startPort)
  const url = `http://127.0.0.1:${port}`
  app.log.info(`LLM Probe server listening on ${url}`)

  // 双击 exe / 生产模式：自动打开默认浏览器
  if (isProd && process.env.NO_OPEN !== '1') {
    openBrowser(url)
    console.log(`\n  LLM Probe 已启动 -> ${url}`)
    console.log('  关闭此窗口即退出服务\n')
  }
}

main().catch((err) => { app.log.error(err); process.exit(1) })
