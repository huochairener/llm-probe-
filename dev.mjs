#!/usr/bin/env node
// 一键开发启动：并发起 server + web，自动打开浏览器
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const isWin = platform() === 'win32'
const WEB_URL = 'http://localhost:5173'

// 用 cross-spawn 风格启动子进程（Windows 需 shell）
function run(cmd, args, name, color) {
  const child = spawn(isWin ? cmd : cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin || process.platform === 'win32'
  })
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`
  child.stdout.on('data', (d) => process.stdout.write(`${prefix} ${d.toString()}`))
  child.stderr.on('data', (d) => process.stderr.write(`${prefix} ${d.toString()}`))
  child.on('exit', (code) => {
    process.stderr.write(`${prefix} 进程退出 code=${code}\n`)
    process.exit(code ?? 0)
  })
  return child
}

const colors = { server: '36', web: '35' }
const server = run('pnpm', ['run', 'server:dev'], 'server', colors.server)
const web = run('pnpm', ['run', 'web:dev'], 'web', colors.web)

// 等 web 端口就绪后打开浏览器
;(async () => {
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try {
      const res = await fetch(WEB_URL, { signal: AbortSignal.timeout(1500) })
      if (res.ok || res.status === 200) break
    } catch { /* 还没就绪 */ }
  }
  // 打开浏览器
  const open = isWin ? 'start' : platform() === 'darwin' ? 'open' : 'xdg-open'
  const openArgs = isWin ? ['', WEB_URL] : [WEB_URL]
  try {
    spawn(open, openArgs, { shell: isWin, stdio: 'ignore', detached: true }).unref()
    console.log(`\x1b[32m✓ 浏览器已打开 ${WEB_URL}\x1b[0m`)
  } catch { /* 忽略 */ }
})()

// Ctrl+C 清理
function cleanup() {
  try { server.kill() } catch {}
  try { web.kill() } catch {}
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
