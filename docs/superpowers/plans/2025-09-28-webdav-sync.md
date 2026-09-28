# WebDAV 配置备份/恢复 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 LLM Probe 增加基于 WebDAV 的配置手动备份/恢复能力，换机或重装时把本地 configs.json + settings.json 一起备份到 WebDAV，再恢复回来。

**架构：** 新增独立模块 `server/src/sync.ts`，用 Node 内建 `fetch` 实现 WebDAV 操作（test/ensureDir/push/pull），不碰加解密——加解密仍由 `storage.ts` 负责。WebDAV 凭据存于 `webdav.json`（URL/账号明文、密码 AES-256-GCM 加密，复用 `storage.ts` 的 `encryptApiKey/decryptApiKey`）。5 个 `/api/sync/*` 路由 + 前端同步面板。恢复后清空 sessions 强制重登。

**技术栈：** Node 22 内建 fetch（无新依赖）、Fastify 4、React 18、zustand、Tailwind CSS、esbuild + Node SEA 打包。

参考规格：`docs/superpowers/specs/2025-09-28-webdav-sync-design.md`

---

## 文件结构

**新建：**
- `server/src/sync.ts` — WebDAV 操作（fetch）+ 备份/恢复编排。职责单一：搬运已加密的字节流，不碰加解密。
- `scripts/test-webdav.mjs` — 全链路手测脚本（无测试框架，纯脚本）。
- `web/src/components/SyncPanel.tsx` — WebDAV 同步面板（配置凭据、测试连接、备份、恢复）。

**修改：**
- `server/src/storage.ts` — 新增 `webdav.json` 读写 + 解密函数；新增 `WEBDAV_FILE` 常量。
- `server/src/auth.ts` — `changePassword` 追加重加密 webdav.json；新增 `clearSessions()`。
- `server/src/routes.ts` — 新增 5 个 `/api/sync/*` 路由。
- `web/src/lib/api.ts` — 新增 sync 相关类型化请求函数。
- `web/src/components/MainLayout.tsx` — 顶栏挂「同步」按钮 + 挂载 SyncPanel modal。

---

## 任务 1：storage 层 — webdav.json 读写与解密

**文件：**
- 修改：`server/src/storage.ts`

**背景：** `storage.ts` 已有 `encryptApiKey(password, plaintext)` / `decryptApiKey(password, packed)`（通用 AES-256-GCM，函数名带 apiKey 但机制通用），以及 `readSettings/writeSettings/readConfigs/writeConfigs` 模式。本任务复用这些机制，新增 webdav.json 的读写。

- [ ] **步骤 1：新增 WEBDAV_FILE 常量与 WebdavConfig 类型**

在 `server/src/storage.ts` 顶部常量区（`CONFIGS_FILE` 定义之后）追加：

```ts
const WEBDAV_FILE = path.join(DATA_DIR, 'webdav.json')

export interface WebdavConfig {
  url: string
  username: string
  passwordCipher: string // base64: salt(16)||iv(12)||ciphertext||authTag(16)
}
```

- [ ] **步骤 2：新增 readWebdavConfig / writeWebdavConfig / clearWebdavConfig**

在 `writeConfigs` 函数之后追加：

```ts
export function readWebdavConfig(): WebdavConfig | null {
  if (!fs.existsSync(WEBDAV_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(WEBDAV_FILE, 'utf8')) as WebdavConfig
  } catch {
    return null
  }
}

export function writeWebdavConfig(cfg: WebdavConfig) {
  ensureDataDir()
  fs.writeFileSync(WEBDAV_FILE, JSON.stringify(cfg, null, 2))
}

export function clearWebdavConfig() {
  if (fs.existsSync(WEBDAV_FILE)) fs.unlinkSync(WEBDAV_FILE)
}
```

- [ ] **步骤 3：新增 getDecryptedWebdavPassword**

在 `decryptApiKey` 函数之后追加：

```ts
export function getDecryptedWebdavPassword(password: string): string | null {
  const cfg = readWebdavConfig()
  if (!cfg || !cfg.passwordCipher) return null
  try {
    return decryptApiKey(password, cfg.passwordCipher)
  } catch {
    return null
  }
}
```

- [ ] **步骤 4：类型检查**

运行：`cd server && pnpm exec tsc --noEmit`
预期：无错误（新函数未使用不会有 unused 报错，因为都 export 了）。

- [ ] **步骤 5：Commit**

```bash
git add server/src/storage.ts
git commit -m "feat(sync): webdav.json 读写与解密函数"
```

> 注：项目当前无 git 仓库，首个任务执行前需先 `git init && git add -A && git commit -m "chore: initial snapshot"` 建立基线。后续任务才能 commit。

---

## 任务 2：auth 层 — changePassword 联动重加密 webdav.json + clearSessions

**文件：**
- 修改：`server/src/auth.ts`

**背景：** `auth.ts` 的 `changePassword(oldPw, newPw)` 现在会重新加密所有 configs 的 apiKey。需在写回 configs 后、写 settings 前，追加重加密 webdav.json。另需新增 `clearSessions()` 供恢复路由在覆盖 settings 后强制重登。

- [ ] **步骤 1：import 新函数**

修改 `server/src/auth.ts` 顶部 import，在现有的 storage 导入里追加 `readWebdavConfig`、`writeWebdavConfig`：

```ts
import { readSettings, writeSettings, hashPassword, verifyPassword, readConfigs, writeConfigs, encryptApiKey, decryptApiKey, readWebdavConfig, writeWebdavConfig } from './storage.js'
```

- [ ] **步骤 2：在 changePassword 里追加重加密 webdav.json**

定位 `changePassword` 方法中 `writeConfigs(reEncrypted)` 这一行之后、`const { salt, hash } = hashPassword(newPw)` 之前，插入：

```ts
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
```

- [ ] **步骤 3：新增 clearSessions 方法**

在 `AuthManager` 类中 `changePassword` 方法之后、类闭合 `}` 之前，新增：

```ts
  /** 恢复 settings 后调用：清空所有会话与内存口令，强制重登 */
  clearSessions() {
    this.sessions.clear()
    this.currentPassword = null
  }
```

- [ ] **步骤 4：类型检查**

运行：`cd server && pnpm exec tsc --noEmit`
预期：无错误。

- [ ] **步骤 5：Commit**

```bash
git add server/src/auth.ts
git commit -m "feat(sync): changePassword 联动重加密 webdav.json + clearSessions"
```

---

## 任务 3：sync 模块 — WebDAV fetch 操作 + 备份/恢复编排

**文件：**
- 创建：`server/src/sync.ts`

**背景：** 用 Node 22 内建 fetch 实现 WebDAV 操作。所有请求带 HTTP Basic Auth。MKCOL 已存在（405）视为成功。备份包为单个 JSON。恢复时二次校验口令匹配。

- [ ] **步骤 1：创建 sync.ts 骨架与类型**

创建 `server/src/sync.ts`：

```ts
import { readConfigs, readSettings, writeConfigs, writeSettings, verifyPassword, type Config, type Settings, type WebdavConfig } from './storage.js'
import { getDecryptedWebdavPassword } from './storage.js'

const BACKUP_PATH = 'llm-probe-backup/backup.json'

export interface BackupPackage {
  version: 1
  createdAt: number
  configs: Config[]
  settings: Settings
}

export interface BackupResult {
  ok: true
  count: number
  createdAt: number
}

export interface RestoreResult {
  ok: true
  count: number
}
```

- [ ] **步骤 2：实现 WebDAV 底层操作**

在 sync.ts 继续追加。所有操作接受 `(webdav: WebdavConfig, password: string)`，密码由调用方解密后传入明文做 Basic Auth：

```ts
function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
}

/** 规范化根 URL：保证结尾有且仅有一个斜杠 */
function normalizeRoot(url: string): string {
  return url.endsWith('/') ? url : url + '/'
}

function backupUrl(webdav: WebdavConfig): string {
  return normalizeRoot(webdav.url) + BACKUP_PATH
}

function dirUrl(webdav: WebdavConfig): string {
  return normalizeRoot(webdav.url) + 'llm-probe-backup/'
}

/** 测试连接：PROPFIND Depth:0 */
export async function testConnection(webdav: WebdavConfig, password: string): Promise<{ ok: true }> {
  const res = await fetch(normalizeRoot(webdav.url), {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(webdav.username, password),
      Depth: '0',
    },
  })
  // 很多 WebDAV 对 PROPFIND 返回 207 Multi-Status；401/403/404 才算失败
  if (res.status === 401 || res.status === 403) {
    throw new Error('WebDAV 认证失败（用户名/密码错误）')
  }
  if (res.status >= 400) {
    throw new Error(`WebDAV 连接失败：HTTP ${res.status}`)
  }
  return { ok: true }
}

/** 确保备份目录存在（MKCOL，已存在则 405，视为成功） */
async function ensureDir(webdav: WebdavConfig, password: string): Promise<void> {
  const res = await fetch(dirUrl(webdav), {
    method: 'MKCOL',
    headers: { Authorization: basicAuth(webdav.username, password) },
  })
  if (res.status === 201 || res.status === 200 || res.status === 405) return
  if (res.status === 401 || res.status === 403) {
    throw new Error('WebDAV 认证失败')
  }
  throw new Error(`创建备份目录失败：HTTP ${res.status}`)
}

async function pushBackup(webdav: WebdavConfig, password: string, body: string): Promise<void> {
  const res = await fetch(backupUrl(webdav), {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(webdav.username, password),
      'Content-Type': 'application/json',
    },
    body,
  })
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败')
  if (!res.ok) throw new Error(`备份写入失败：HTTP ${res.status}`)
}

async function pullBackup(webdav: WebdavConfig, password: string): Promise<string> {
  const res = await fetch(backupUrl(webdav), {
    method: 'GET',
    headers: { Authorization: basicAuth(webdav.username, password) },
  })
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败')
  if (res.status === 404) throw new Error('远端没有备份文件，请先备份')
  if (!res.ok) throw new Error(`拉取备份失败：HTTP ${res.status}`)
  return res.text()
}
```

- [ ] **步骤 3：实现 doBackup 编排**

继续在 sync.ts 追加：

```ts
export async function doBackup(webdav: WebdavConfig, password: string): Promise<BackupResult> {
  const configs = readConfigs()
  const settings = readSettings()
  const pkg: BackupPackage = {
    version: 1,
    createdAt: Date.now(),
    configs,
    settings,
  }
  await ensureDir(webdav, password)
  await pushBackup(webdav, password, JSON.stringify(pkg, null, 2))
  return { ok: true, count: configs.length, createdAt: pkg.createdAt }
}
```

- [ ] **步骤 4：实现 doRestore 编排（含二次口令校验）**

继续追加：

```ts
export async function doRestore(webdav: WebdavConfig, password: string): Promise<RestoreResult> {
  const raw = await pullBackup(webdav, password)
  let pkg: BackupPackage
  try {
    pkg = JSON.parse(raw)
  } catch {
    throw new Error('远端备份文件不是合法 JSON')
  }
  if (pkg.version !== 1 || !Array.isArray(pkg.configs) || !pkg.settings) {
    throw new Error('备份文件格式或版本不兼容')
  }
  if (!pkg.settings.hasPassword) {
    throw new Error('备份的 settings 缺少口令，无法安全恢复')
  }
  // 二次校验：当前输入的口令必须能匹配备份里的口令 hash，否则恢复后 apiKey 解不开
  const matched = verifyPassword(password, pkg.settings.passwordSalt, pkg.settings.passwordHash)
  if (!matched) {
    throw new Error('当前口令与备份中的口令不匹配，无法解密恢复出的 apiKey')
  }
  writeSettings(pkg.settings)
  writeConfigs(pkg.configs)
  return { ok: true, count: pkg.configs.length }
}
```

- [ ] **步骤 5：导出 getDecryptedWebdavPassword 透传（供路由层用）**

实际上 sync.ts 已 import 了 `getDecryptedWebdavPassword` 但未使用（路由层会直接从 storage import）。为避免 unused import 报错，移除 sync.ts 顶部那行多余的 import。把第一步代码块里的 `import { getDecryptedWebdavPassword } from './storage.js'` 这一行删掉。

- [ ] **步骤 6：类型检查**

运行：`cd server && pnpm exec tsc --noEmit`
预期：无错误。

- [ ] **步骤 7：Commit**

```bash
git add server/src/sync.ts
git commit -m "feat(sync): WebDAV fetch 操作与备份/恢复编排"
```

---

## 任务 4：路由层 — 5 个 /api/sync/* 路由

**文件：**
- 修改：`server/src/routes.ts`

**背景：** `routes.ts` 已有 `authGuard` 模式与 `authMgr.getPassword(token)` 取明文口令的模式。本任务新增 5 个路由，其中 `/api/sync/status` 不加 authGuard（登录页需在未解锁时判断是否已配过 WebDAV，但密码字段绝不返回）。

- [ ] **步骤 1：import sync 与 webdav storage 函数**

修改 `server/src/routes.ts` 顶部，在现有 import 块后追加：

```ts
import { readWebdavConfig, writeWebdavConfig, clearWebdavConfig, getDecryptedWebdavPassword } from './storage.js'
import { testConnection, doBackup, doRestore } from './sync.js'
import type { WebdavConfig } from './storage.js'
```

- [ ] **步骤 2：实现 GET /api/sync/status（无鉴权，不返回密码）**

在 `registerRoutes` 内、`/api/health` 路由之后，新增：

```ts
  // ---- WebDAV 同步 ----
  app.get('/api/sync/status', async () => {
    const wd = readWebdavConfig()
    if (!wd) return { configured: false }
    return { configured: true, url: wd.url, username: wd.username }
  })
```

- [ ] **步骤 3：实现 PUT /api/sync/config（保存凭据，需鉴权）**

继续追加：

```ts
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
```

注意：需在 `routes.ts` 顶部 import 里追加 `encryptApiKey`（来自 `./storage.js`）。把第 1 步的 storage import 改为：

```ts
import { readWebdavConfig, writeWebdavConfig, clearWebdavConfig, getDecryptedWebdavPassword, encryptApiKey } from './storage.js'
```

（`clearWebdavConfig`、`getDecryptedWebdavPassword` 在后续路由用到，先一起 import。）

- [ ] **步骤 4：实现 POST /api/sync/test（测试连接，需鉴权）**

继续追加：

```ts
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
```

- [ ] **步骤 5：实现 POST /api/sync/backup（备份，需鉴权）**

继续追加：

```ts
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
```

- [ ] **步骤 6：实现 POST /api/sync/restore（恢复，需鉴权，成功后 clearSessions）**

继续追加：

```ts
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
```

注意 `auth` 与 `authMgr` 是同一个对象的两个别名（见 routes.ts 顶部已有 `import { auth, authGuard }` 与 `import { auth as authMgr }`），调用 `auth.clearSessions()` 即可。无需新增 import。

- [ ] **步骤 7：类型检查 + dev 起服务冒烟**

运行：`cd server && pnpm exec tsc --noEmit`
预期：无错误。

运行：`cd D:/practiceProjects/llm-test && pnpm dev`（后台启动，前端开 http://localhost:5173）
手动用浏览器访问 http://localhost:5173/api/sync/status 预期返回 `{"configured":false}`。验证后停掉 dev 服务。

- [ ] **步骤 8：Commit**

```bash
git add server/src/routes.ts
git commit -m "feat(sync): 5 个 /api/sync/* 路由"
```

---

## 任务 5：前端 api 层 — sync 请求函数

**文件：**
- 修改：`web/src/lib/api.ts`

**背景：** `api.ts` 已封装 `request<T>` + `api.get/post/put/del`，401 自动清 token 刷新。新增 sync 相关类型化方法。

- [ ] **步骤 1：在 api 对象末尾追加 sync 方法**

修改 `web/src/lib/api.ts`，在 `export const api = { ... }` 对象的 `del` 之后、闭合 `}` 之前，追加（注意保留对象内逗号）：

```ts
  ,
  syncStatus: () => request<{ configured: boolean; url?: string; username?: string }>('/api/sync/status', { method: 'GET' }),
  syncSaveConfig: (body: { url: string; username: string; password: string }) =>
    request<{ ok: true }>('/api/sync/config', { method: 'PUT', body: JSON.stringify(body) }),
  syncTest: () => request<{ ok: true }>('/api/sync/test', { method: 'POST' }),
  syncBackup: () => request<{ ok: true; count: number; createdAt: number }>('/api/sync/backup', { method: 'POST' }),
  syncRestore: () => request<{ ok: true; count: number }>('/api/sync/restore', { method: 'POST' }),
```

- [ ] **步骤 2：类型检查**

运行：`cd web && pnpm exec tsc --noEmit`（若 web 有独立 tsconfig；若 workspace 合一则在根目录 `pnpm exec tsc --noEmit`）
预期：无错误。

- [ ] **步骤 3：Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(sync): 前端 sync api 请求函数"
```

---

## 任务 6：前端 SyncPanel 组件 + MainLayout 挂载

**文件：**
- 创建：`web/src/components/SyncPanel.tsx`
- 修改：`web/src/components/MainLayout.tsx`

**背景：** 前端用 Tailwind class（`btn btn-primary/secondary`、`input`、`card` 等已存在）。MainLayout 顶栏右侧已有「退出登录」按钮，在其左侧加「☁ 同步」按钮打开 modal。状态：未配置显示表单，已配置显示信息+操作。恢复成功后调用 `logout()` 走 store 的退出流程（清 configs+token+跳登录页）。

- [ ] **步骤 1：创建 SyncPanel.tsx 骨架与状态/数据加载**

创建 `web/src/components/SyncPanel.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'

interface SyncStatus {
  configured: boolean
  url?: string
  username?: string
}

export default function SyncPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const logout = useStore((s) => s.logout)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)

  // 表单字段
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function loadStatus() {
    try {
      const s = await api.syncStatus()
      setStatus(s)
      if (s.configured) {
        setUrl(s.url || '')
        setUsername(s.username || '')
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (open) {
      setMsg(null)
      loadStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
```

- [ ] **步骤 2：实现保存凭据与测试连接**

继续追加：

```tsx
  async function handleSaveConfig() {
    setMsg(null)
    if (!url || !username || !password) {
      setMsg({ type: 'error', text: '请填写完整 URL / 用户名 / 密码' })
      return
    }
    setLoading(true)
    try {
      await api.syncSaveConfig({ url, username, password })
      setMsg({ type: 'success', text: '已保存 WebDAV 凭据' })
      setPassword('')
      await loadStatus()
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleTest() {
    setMsg(null)
    setLoading(true)
    try {
      await api.syncTest()
      setMsg({ type: 'success', text: '连接成功' })
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **步骤 3：实现备份与恢复（恢复前二次确认 + 成功后 logout）**

继续追加：

```tsx
  async function handleBackup() {
    setMsg(null)
    setLoading(true)
    try {
      const r = await api.syncBackup()
      setMsg({ type: 'success', text: `已备份 ${r.count} 条配置` })
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore() {
    setMsg(null)
    if (!window.confirm('恢复将覆盖本地所有配置与口令 hash，确定继续？')) return
    setLoading(true)
    try {
      const r = await api.syncRestore()
      setMsg({ type: 'success', text: `已恢复 ${r.count} 条配置，即将重新登录…` })
      // settings 已被覆盖，强制重登
      setTimeout(() => {
        logout()
        onClose()
      }, 800)
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **步骤 4：实现 JSX 渲染**

继续追加（闭合组件）：

```tsx
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">WebDAV 同步</h2>
          <button className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={onClose}>×</button>
        </div>

        {msg && (
          <div className={`text-sm px-3 py-2 rounded mb-4 ${
            msg.type === 'error' ? 'bg-red-50 text-red-600' :
            msg.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-600'
          }`}>{msg.text}</div>
        )}

        {status?.configured ? (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              <div><span className="text-slate-400">URL：</span>{status.url}</div>
              <div><span className="text-slate-400">用户：</span>{status.username}</div>
            </div>
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={handleBackup} disabled={loading}>
                {loading ? '备份中…' : '⬆ 备份到 WebDAV'}
              </button>
              <button className="btn btn-secondary flex-1" onClick={handleRestore} disabled={loading}>
                ⬇ 从 WebDAV 恢复
              </button>
            </div>
            <button className="btn btn-secondary w-full text-sm" onClick={handleTest} disabled={loading}>
              测试连接
            </button>
            <button className="text-sm text-indigo-600 hover:underline w-full text-center" onClick={() => { setStatus({ configured: false }); setUrl(status.url || ''); setUsername(status.username || ''); setPassword('') }}>
              修改 WebDAV 凭据
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input className="input" placeholder="WebDAV 根 URL（如 https://dav.example.com/dav/）"
              value={url} onChange={(e) => setUrl(e.target.value)} />
            <input className="input" placeholder="用户名"
              value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className="input" type="password" placeholder="密码"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-3">
              <button className="btn btn-secondary flex-1" onClick={handleTest} disabled={loading || !url || !username || !password}>
                测试连接
              </button>
              <button className="btn btn-primary flex-1" onClick={handleSaveConfig} disabled={loading}>
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **步骤 5：MainLayout 挂载同步按钮与 modal**

修改 `web/src/components/MainLayout.tsx`。

5a. 顶部 import 追加：

```ts
import SyncPanel from './SyncPanel'
```

5b. 在 `MainLayout` 组件内 `const [editing, setEditing] = useState(...)` 这行之后追加状态：

```ts
  const [syncOpen, setSyncOpen] = useState(false)
```

5c. 在顶栏的「退出登录」按钮**之前**插入同步按钮（即 `<button className="btn btn-secondary text-sm" onClick={logout}>退出登录</button>` 这行之前）：

```tsx
          <button className="btn btn-secondary text-sm mr-2" onClick={() => setSyncOpen(true)}>☁ 同步</button>
```

5d. 在组件返回的 JSX 最末尾，`<ConfigForm ... />` 之后、最外层 `</div>` 之前，追加：

```tsx
      <SyncPanel open={syncOpen} onClose={() => setSyncOpen(false)} />
```

- [ ] **步骤 6：类型检查**

运行：`cd D:/practiceProjects/llm-test && pnpm --filter @llm-probe/web exec tsc --noEmit`（若 web 无独立 tsc 脚本，则 `cd web && pnpm exec tsc --noEmit`）
预期：无错误。

- [ ] **步骤 7：dev 起服务人工冒烟**

运行：`cd D:/practiceProjects/llm-test && pnpm dev`

人工验证：
1. 设置口令并进入主界面。
2. 点顶栏「☁ 同步」，打开面板，显示未配置表单。
3. 填一个真实 WebDAV URL/账号/密码（或本地 rclone serve webdav），点「测试连接」，预期 success。
4. 点「保存」，面板切到已配置视图，显示 URL/用户。
5. 点「备份到 WebDAV」，预期 toast `已备份 N 条配置`。
6. （可选，有风险）新建一条不同配置后点「从 WebDAV 恢复」，二次确认，预期覆盖回旧的、提示重新登录。
7. 停 dev 服务。

- [ ] **步骤 8：Commit**

```bash
git add web/src/components/SyncPanel.tsx web/src/components/MainLayout.tsx
git commit -m "feat(sync): SyncPanel 组件与 MainLayout 挂载"
```

---

## 任务 7：全链路手测脚本

**文件：**
- 创建：`scripts/test-webdav.mjs`

**背景：** 项目无测试框架。本脚本对一个真实 WebDAV 端点跑 test→ensureDir→backup→restore 全链路，验证 MKCOL 405 幂等、push/pull 一致性、restore 二次口令校验。需要用户提供 WebDAV 端点；端点通过环境变量传入。

- [ ] **步骤 1：创建手测脚本**

创建 `scripts/test-webdav.mjs`：

```js
// WebDAV 同步全链路手测脚本
// 用法：
//   WEBDAV_URL=https://dav.example.com/dav/ WEBDAV_USER=user WEBDAV_PASS=pass node scripts/test-webdav.mjs
//
// 前置：先在本机设置好口令并解锁（脚本直接调 sync.ts 的函数，不经 HTTP）。
// 为简化，本脚本直接复用 server/src 的函数——但 server 是 ESM + TS，
// 故用 tsx 运行： npx tsx scripts/test-webdav.mjs   （.mjs 不转 TS，改用 .ts 更顺）
// → 实际用 .mts + tsx：见下面说明
```

> 说明：由于 `server/src` 是 TypeScript（ESM + NodeNext），手测脚本直接 import ts 源不便。改用**黑盒**方式——脚本对**正在运行的 dev/start 服务**发 HTTP 请求，覆盖 5 个路由。这样脚本是纯 JS、无编译、无依赖。

改为创建 `scripts/test-webdav.mjs`：

```js
// WebDAV 同步全链路手测脚本（黑盒，对运行中的服务发 HTTP）
//
// 前置：
//   1. pnpm dev（或 pnpm start）已起，http://127.0.0.1:3173 可用
//   2. 已设置口令并解锁——把解锁后的 token 放到环境变量 SESSION
//   3. WebDAV 凭据放到环境变量：
//        WEBDAV_URL / WEBDAV_USER / WEBDAV_PASS
//
// 用法：
//   BASE=http://127.0.0.1:3173 SESSION=<token> WEBDAV_URL=... WEBDAV_USER=... WEBDAV_PASS=... node scripts/test-webdav.mjs

const BASE = process.env.BASE || 'http://127.0.0.1:3173'
const SESSION = process.env.SESSION
const { WEBDAV_URL, WEBDAV_USER, WEBDAV_PASS } = process.env

if (!SESSION || !WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASS) {
  console.error('请设置 SESSION / WEBDAV_URL / WEBDAV_USER / WEBDAV_PASS 环境变量')
  process.exit(1)
}

const headers = { 'Content-Type': 'application/json', 'x-session': SESSION }
let pass = 0, fail = 0

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name} ${detail}`) }
}

async function main() {
  // 1. status 初始应为未配置
  let r = await fetch(`${BASE}/api/sync/status`, { headers })
  let j = await r.json()
  check('GET /status 初始 configured=false', j.configured === false, JSON.stringify(j))

  // 2. 保存凭据
  r = await fetch(`${BASE}/api/sync/config`, {
    method: 'PUT', headers,
    body: JSON.stringify({ url: WEBDAV_URL, username: WEBDAV_USER, password: WEBDAV_PASS }),
  })
  j = await r.json()
  check('PUT /config 保存成功', r.ok && j.ok, JSON.stringify(j))

  // 3. status 现在应返回已配置但不带密码
  r = await fetch(`${BASE}/api/sync/status`, { headers })
  j = await r.json()
  check('GET /status 已配置', j.configured === true && j.url === WEBDAV_URL && !('passwordCipher' in j), JSON.stringify(j))

  // 4. 测试连接
  r = await fetch(`${BASE}/api/sync/test`, { method: 'POST', headers })
  j = await r.json()
  check('POST /test 连接成功', r.ok && j.ok, JSON.stringify(j))

  // 5. 备份
  r = await fetch(`${BASE}/api/sync/backup`, { method: 'POST', headers })
  j = await r.json()
  check('POST /backup 备份成功', r.ok && typeof j.count === 'number', JSON.stringify(j))
  const backupCount = j.count

  // 6. 二次备份（验证 MKCOL 405 幂等，目录已存在不应失败）
  r = await fetch(`${BASE}/api/sync/backup`, { method: 'POST', headers })
  j = await r.json()
  check('POST /backup 二次备份成功（MKCOL 幂等）', r.ok && j.count === backupCount, JSON.stringify(j))

  // 7. 恢复（口令正确，应成功并清 session）
  r = await fetch(`${BASE}/api/sync/restore`, { method: 'POST', headers })
  j = await r.json()
  check('POST /restore 恢复成功', r.ok && j.count === backupCount, JSON.stringify(j))

  // 8. 恢复后旧 session 应失效（clearSessions）
  r = await fetch(`${BASE}/api/configs`, { headers })
  check('恢复后旧 session 失效（401）', r.status === 401, `status=${r.status}`)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **步骤 2：人工跑脚本验证（需真实 WebDAV）**

前提：本地起一个 WebDAV（如 `rclone serve webdav local: ./webdav-root --addr :8080 --user user pass`）。

步骤：
1. `cd D:/practiceProjects/llm-test && pnpm dev`
2. 浏览器设置口令、解锁，从 DevTools 复制 localStorage 的 `llm-probe-session` 作为 SESSION。
3. 运行：
   ```
   BASE=http://127.0.0.1:3173 SESSION=<token> WEBDAV_URL=http://127.0.0.1:8080/ WEBDAV_USER=user WEBDAV_PASS=pass node scripts/test-webdav.mjs
   ```
预期：8 项全部 ✓，退出码 0。

> 若手头暂无 WebDAV 端点，本步骤可标记为「待用户具备环境后执行」，但不阻塞其余任务的提交——脚本本身的正确性已在代码层 review。

- [ ] **步骤 3：Commit**

```bash
git add scripts/test-webdav.mjs
git commit -m "test(sync): WebDAV 同步全链路黑盒脚本"
```

---

## 任务 8：SEA 单 exe 打包验证

**文件：**
- 无修改，仅验证 `build/make-exe.mjs` 与 `sea-config.json` 现有流程是否覆盖新增的 sync.ts。

**背景：** 后端经 esbuild bundle 成单文件 CJS 注入 SEA。新增的 `sync.ts` 是纯 TS + Node 内建 fetch，无新依赖、无原生模块，理论上自动被 esbuild 打进去。本任务验证这一点。

- [ ] **步骤 1：构建 exe**

运行：`cd D:/practiceProjects/llm-test && pnpm build:exe`
预期：无 esbuild 报错，生成 `dist/LLM-Probe.exe`。

- [ ] **步骤 2：跑 exe 验证 sync 路由可达**

运行（后台）：`./dist/LLM-Probe.exe`（会自动开浏览器）

人工验证：
1. 首次设口令、解锁。
2. 点「☁ 同步」打开面板。
3. 若有 WebDAV 端点，测试连接 + 备份一次，确认在 exe 下可用。
4. 关闭 exe 窗口。

- [ ] **步骤 3：Commit（若有打包配置调整）**

若 `sea-config.json` / `build/make-exe.mjs` 无需改动（预期如此），跳过 commit。若有调整则：

```bash
git add build/ sea-config.json
git commit -m "chore(sync): SEA 打包兼容 sync 模块"
```

---

## 自检

**1. 规格覆盖度：** 对照规格各章节/需求：

| 规格章节/需求 | 实现任务 |
|---------------|---------|
| §1 总体架构（sync.ts + 单 JSON 包 + 固定路径） | 任务 3 |
| §1 备份包格式 `{version, createdAt, configs, settings}` | 任务 3 步骤 1、3 |
| §2 webdav.json（URL/账号明文、密码加密） | 任务 1 |
| §2 改密联动重加密 webdav.json | 任务 2 步骤 2 |
| §3 testConnection/ensureDir/pushBackup/pullBackup | 任务 3 步骤 2 |
| §3 MKCOL 405 幂等 | 任务 3 步骤 2（ensureDir）+ 任务 7 步骤 2 验证 |
| §4 doBackup/doRestore | 任务 3 步骤 3、4 |
| §4 恢复二次口令校验 | 任务 3 步骤 4（verifyPassword） |
| §4 恢复后 clearSessions 强制重登 | 任务 2 步骤 3 + 任务 4 步骤 6 + 任务 6 步骤 3 |
| §4 改密联动 | 任务 2 步骤 2 |
| §5 5 个路由 | 任务 4 |
| §5 /api/sync/status 无鉴权、不返密码 | 任务 4 步骤 2 + 任务 7 步骤 2 验证 |
| §5 前端面板（未配置表单 / 已配置操作 / 二次确认 / 恢复后重登） | 任务 6 |
| §6 手测脚本 | 任务 7 |
| §6 SEA 打包验证 | 任务 8 |
| §6 恢复后重登验证 | 任务 7 步骤 2 第 8 项 |

无遗漏。

**2. 占位符扫描：** 计划中无 "TODO/待定/后续实现/类似任务 N/添加适当错误处理"。每步都有实际代码或可执行命令。任务 8 步骤 3 标注「若有调整才 commit」是条件分支，非占位符。✓

**3. 类型一致性：**
- `WebdavConfig` 接口：任务 1 定义，任务 3（参数）、任务 4 步骤 3（PUT 路由）使用，字段 `url/username/passwordCipher` 一致。✓
- `BackupPackage`/`BackupResult`/`RestoreResult`：任务 3 定义，任务 3 内部使用。✓
- `readWebdavConfig/writeWebdavConfig/clearWebdavConfig/getDecryptedWebdavPassword/encryptApiKey`：任务 1 定义，任务 4 使用。✓
- `testConnection/doBackup/doRestore`：任务 3 定义，任务 4 使用。✓
- `auth.clearSessions()`：任务 2 定义，任务 4 步骤 6 使用。✓
- 前端 `api.syncStatus/syncSaveConfig/syncTest/syncBackup/syncRestore`：任务 5 定义，任务 6 使用，命名一致。✓
- `SyncPanel` props `{ open, onClose }`：任务 6 定义与 MainLayout 使用一致。✓

任务 3 步骤 5 已主动移除多余 import 防 unused 报错。✓

无问题，计划可执行。
