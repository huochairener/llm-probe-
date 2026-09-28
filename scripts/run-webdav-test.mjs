// 编排脚本：安全地跑通 WebDAV 同步全链路，不动用户的真实 server/data
//
// 流程：
//   1. 把 server/data 暂存为 server/data.realtestbak（若已存在则报错，避免覆盖另一个备份）
//   2. 建空 server/data
//   3. 启动 mock webdav（:8080）+ 应用服务器（:3199）
//   4. 对应用设口令 test1234、解锁拿 token
//   5. 跑 scripts/test-webdav.mjs 的逻辑（直接 import/eval 等价代码）
//   6. finally：无论如何恢复 server/data
//
// 用法：node scripts/run-webdav-test.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'server', 'data')
const bakDir = path.join(root, 'server', 'data.realtestbak')

const APP_PORT = 3199
const WEBDAV_PORT = 8080
const WEBDAV_USER = 'user'
const WEBDAV_PASS = 'pass'
const PASSWORD = 'test1234'

const procs = []

function cleanup() {
  for (const p of procs) { try { p.kill('SIGKILL') } catch {} }
  // 恢复 server/data：删除测试用空目录，把备份移回
  try {
    if (fs.existsSync(bakDir)) {
      if (fs.existsSync(dataDir)) {
        // 删除测试用的空 data（应只有 settings/configs/webdav 几个文件）
        for (const f of fs.readdirSync(dataDir)) {
          fs.unlinkSync(path.join(dataDir, f))
        }
        fs.rmdirSync(dataDir)
      }
      fs.renameSync(bakDir, dataDir)
      console.log('\n[orchestration] server/data 已恢复')
    }
  } catch (e) {
    console.error('[orchestration] 恢复 server/data 失败！备份在:', bakDir, e)
  }
}

process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1) })

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function waitFor(url, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 401 || res.status === 404) return
    } catch {}
    await sleep(200)
  }
  throw new Error(`等待 ${url} 超时`)
}

async function main() {
  // 1. 暂存 server/data
  if (fs.existsSync(bakDir)) {
    throw new Error(`备份目录已存在：${bakDir}，请先清理（可能上次测试异常退出）`)
  }
  if (fs.existsSync(dataDir)) {
    fs.renameSync(dataDir, bakDir)
    console.log('[orchestration] server/data 已暂存到 server/data.realtestbak')
  }
  fs.mkdirSync(dataDir, { recursive: true })

  // 2. 启动 mock webdav
  const webdav = spawn('node', ['scripts/mock-webdav.mjs'], {
    cwd: root,
    env: { ...process.env, WEBDAV_PORT: String(WEBDAV_PORT), WEBDAV_USER, WEBDAV_PASS },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  procs.push(webdav)
  webdav.stdout.on('data', (d) => process.stdout.write(`[webdav] ${d}`))

  // 3. 启动应用（构建后的 server/dist/index.js）
  const app = spawn('node', ['server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(APP_PORT), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  procs.push(app)
  app.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`))
  app.stderr.on('data', (d) => process.stderr.write(`[app:err] ${d}`))

  await waitFor(`http://127.0.0.1:${WEBDAV_PORT}/`, 5000)
  await waitFor(`http://127.0.0.1:${APP_PORT}/api/health`, 8000)
  console.log('[orchestration] 两个服务都起来了')

  // 4. 设口令 + 解锁
  let r = await fetch(`http://127.0.0.1:${APP_PORT}/api/auth/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!r.ok) throw new Error(`setup 失败: ${r.status} ${await r.text()}`)
  r = await fetch(`http://127.0.0.1:${APP_PORT}/api/auth/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  const { token } = await r.json()
  if (!token) throw new Error('unlock 未返回 token')
  console.log('[orchestration] 口令已设置并解锁，token 拿到')

  // 5. 跑黑盒脚本作为子进程（保持脚本独立性）
  const testEnv = {
    ...process.env,
    BASE: `http://127.0.0.1:${APP_PORT}`,
    SESSION: token,
    WEBDAV_URL: `http://127.0.0.1:${WEBDAV_PORT}/`,
    WEBDAV_USER,
    WEBDAV_PASS,
  }
  const test = spawn('node', ['scripts/test-webdav.mjs'], {
    cwd: root,
    env: testEnv,
    stdio: 'inherit',
  })
  await new Promise((resolve) => test.on('close', (code) => {
    cleanup()
    if (code !== 0) {
      console.error(`\n[orchestration] 黑盒脚本退出码 ${code}`)
      process.exit(code)
    }
    resolve()
  }))
  console.log('\n[orchestration] 全链路测试通过 ✓')
}

main().catch((e) => {
  console.error('[orchestration] 失败:', e)
  cleanup()
  process.exit(1)
})
