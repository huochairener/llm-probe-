# 设计：WebDAV 配置备份/恢复

日期：2025-09-28
状态：已批准（待编写实现计划）

## 目标

为 LLM Probe 增加 WebDAV 配置同步能力，用于在换机/重装时把本地配置备份到 WebDAV、再恢复回来。**单向备份/恢复，纯手动触发**，不做双向同步或自动备份。

## 背景与约束

现有数据：

- `server/data/configs.json` — 配置列表，`apiKeyCipher` 字段为 AES-256-GCM 密文，密钥由**本机口令**经 scrypt 派生。
- `server/data/settings.json` — 口令 scrypt hash（不可逆），`hasPassword/salt/hash`。

核心安全约束：apiKey 密文绑定本机口令。换机恢复时若口令不一致则无法解密。因此 **备份必须同时包含 settings.json**，使恢复后口令 hash 一并回来、用原口令即可登录解密——这是本设计选择「configs + settings 一起备份」的根本原因。

打包约束：后端经 esbuild 打成单文件 CJS 注入 Node SEA exe。WebDAV 客户端**不得引入新依赖、不得有原生模块**，用 Node 22 内建 `fetch` 实现最干净。

## 决策摘要

| 决策点 | 选择 |
|--------|------|
| 同步场景 | 仅备份/恢复（单向） |
| 备份范围 | configs.json + settings.json |
| 触发方式 | 手动备份 + 手动恢复 |
| WebDAV 凭据存储 | URL/账号明文、密码加密（webdav.json） |
| WebDAV 客户端 | fetch（无新依赖，SEA 可打包） |

## 第 1 节：总体架构

新增独立模块 `server/src/sync.ts`，与 `storage.ts`/`config.ts`/`auth.ts` 平行。职责单一：WebDAV 文件的 PUT/GET 与备份/恢复编排。**不碰加解密**——加解密仍由 `storage.ts` 负责，sync 只搬运「已经加密好的」字节流。

数据流：

```
备份(push):  readConfigs() + readSettings() → 打包 JSON → ensureDir → WebDAV PUT backup.json
恢复(pull):  WebDAV GET backup.json → 校验 → 二次校验口令匹配 → 覆盖写 configs.json + settings.json
```

备份包格式（单个 JSON 文件，一次 PUT/GET）：

```json
{
  "version": 1,
  "createdAt": 1700000000000,
  "configs": [...],
  "settings": { "hasPassword": true, "passwordSalt": "...", "passwordHash": "..." }
}
```

WebDAV 路径固定：`<用户配置的 url 根>/llm-probe-backup/backup.json`。目录不存在则 `MKCOL` 创建。

## 第 2 节：WebDAV 凭据存储

新建 `server/data/webdav.json`：

```json
{
  "url": "https://dav.example.com/dav/",
  "username": "user",
  "passwordCipher": "<base64: salt(16)||iv(12)||ciphertext||authTag(16)>"
}
```

- `url`、`username` 明文（未解锁时设置页/登录页也能显示「已配置到 xxx」）。
- `password` 复用 `storage.ts` 的 `encryptApiKey`/`decryptApiKey`（通用 AES-256-GCM，函数名虽叫 apiKey 但机制通用），用**当前口令**派生密钥加密。
- 与 `configs.json` 的 apiKey 同等保护：**改密时必须重加密**（在 `auth.changePassword` 现有循环里追加）。

`storage.ts` 新增：`readWebdavConfig()` / `writeWebdavConfig(cfg)` / `getDecryptedWebdavPassword(password)`。

## 第 3 节：WebDAV 操作（fetch 实现）

`sync.ts` 用 Node 内建 `fetch` 实现 4 个操作，均带 HTTP Basic Auth（`Authorization: Basic base64(user:pass)`）：

| 操作 | HTTP 方法 | 用途 |
|------|-----------|------|
| `testConnection` | `PROPFIND`（Depth: 0） | 验证 URL/账号/密码可达，保存时「测试连接」 |
| `ensureDir` | `MKCOL` | 备份前确保 `llm-probe-backup/` 目录存在 |
| `pushBackup` | `PUT` | 写 `backup.json` |
| `pullBackup` | `GET` | 取回 `backup.json` |

URL 拼接：用户填的 `url` 作为根，字符串拼接 `llm-probe-backup/backup.json`（WebDAV 用 `/`），结尾补全斜杠。

**MKCOL 幂等**：目录已存在时 WebDAV 返回 `405 Method Not Allowed`，sync 层视为成功（不报错），避免首次备份失败。其他非 2xx 抛 `Error`，由路由层转 4xx/5xx。

## 第 4 节：备份/恢复逻辑与安全

**`doBackup(password)`：**

1. `readConfigs()` + `readSettings()` 打包 `{version:1, createdAt:Date.now(), configs, settings}`。
2. `ensureDir()` → `pushBackup(json)`。
3. 返回 `{ ok:true, count:configs.length, createdAt }`。

**`doRestore(password)`：**

1. `pullBackup()` → 解析 JSON，校验 `version===1` 且 `settings.hasPassword===true`。
2. **二次校验口令**：用恢复回来的 `settings`（salt/hash）`verifyPassword(password, ...)`，验证当前输入口令能匹配——防止「恢复一个用别的口令加密的备份」导致 apiKey 解不开却不自知。
3. 校验通过 → `writeSettings(restored.settings)` + `writeConfigs(restored.configs)`。
4. 返回 `{ ok:true, count }`。

**恢复的覆盖保护**：恢复会覆盖本地 `configs.json`/`settings.json`。前端调用前给**二次确认弹窗**（「将覆盖本地 N 条配置，确定恢复？」）。后端为纯函数、不做确认。

**恢复后强制重登**：恢复覆盖 settings 后口令 hash 已变，旧 session token 必须失效。`doRestore` 成功后路由层调用 `auth.clearSessions()`（新增方法，清空 `sessions` 集合与 `currentPassword`）强制重登。

**改密联动**：`auth.changePassword` 现有重加密 configs 的循环里，追加重加密 `webdav.json` 的 `passwordCipher`（若 webdav.json 存在）。

## 第 5 节：API 路由与前端 UI

**后端路由**（加到 `routes.ts`）：

| 方法 | 路径 | 鉴权 | 用途 |
|------|------|------|------|
| `GET` | `/api/sync/status` | 无 | 返回 `{ configured, url, username }`（密码不返回）|
| `PUT` | `/api/sync/config` | authGuard | 保存 WebDAV 凭据（body: url/username/password）|
| `POST` | `/api/sync/test` | authGuard | 用已存凭据测试连接 |
| `POST` | `/api/sync/backup` | authGuard | 执行备份 |
| `POST` | `/api/sync/restore` | authGuard | 执行恢复 |

`/api/sync/status` 不加 authGuard 且不返回密码，无泄露风险——登录页可据此显示「本机已配置 WebDAV 同步到 xxx」。

**前端 UI**：在 `MainLayout` 设置区新增「WebDAV 同步」面板：

- **未配置**：表单（URL / 用户名 / 密码 / 测试连接 / 保存）。
- **已配置**：显示 URL+用户名 + 「备份」「恢复」「修改凭据」按钮。
- 备份成功 toast `已备份 N 条配置`。
- 恢复前二次确认弹窗 → 恢复成功后提示「口令 hash 已更新，请重新登录」并触发 logout/跳登录页。

## 第 6 节：测试与边界

**验证清单**（项目无测试框架，用临时脚本 + 手测）：

1. **WebDAV 全链路手测脚本** `scripts/test-webdav.mjs`：对真实/本地 WebDAV（如 `rclone serve webdav`）跑 test → backup → restore 全链路，打印每步状态码与返回体。验证项：
   - testConnection 成功返回。
   - 首次 ensureDir（MKCOL 201）成功。
   - 二次备份 ensureDir 返回 405 仍成功（幂等）。
   - pushBackup 后 pullBackup 内容一致。
   - restore 二次校验口令：错误口令应被拒、正确口令放行。
2. **SEA 打包验证**：`pnpm build:exe` 后跑 exe，确认 fetch + 新 sync 代码打进 exe、备份功能在 exe 下可用（无新依赖，fetch 为 Node 内建）。
3. **恢复后重登**：恢复覆盖 settings 后旧 session 失效——验证 `auth.clearSessions()` 生效、前端被踢回登录页。

**边界与不做（YAGNI）**：

- ❌ 不做自动/定时备份（用户选纯手动）。
- ❌ 不做双向合并或冲突解决（场景是单向备份/恢复）。
- ❌ 不做多版本备份历史（只覆盖单个 `backup.json`）。
- ❌ 不做 settings.json 的口令冲突检测（恢复时二次校验口令匹配即兜底）。

## 涉及文件

新增：

- `server/src/sync.ts` — WebDAV 操作 + 备份/恢复编排。
- `server/data/webdav.json` — 运行时生成，gitignore。
- `scripts/test-webdav.mjs` — 手测脚本。
- `web/src/components/SyncPanel.tsx`（或并入现有设置区）。

修改：

- `server/src/storage.ts` — 新增 webdav.json 读写 + 解密。
- `server/src/auth.ts` — `changePassword` 追加重加密 webdav.json；新增 `clearSessions()`。
- `server/src/routes.ts` — 新增 5 个 `/api/sync/*` 路由。
- `web/src/lib/api.ts` — 新增 sync 相关请求函数。
- `web/src/components/MainLayout.tsx` — 挂载同步面板入口。

## 安全说明

- WebDAV 密码与 apiKey 同等保护（口令派生 AES-256-GCM）。
- 口令丢失后 WebDAV 密码同样不可恢复（设计如此，与 apiKey 一致）。
- 恢复流程的二次口令校验防止「恢复到错误口令」的静默失败。
- `/api/sync/status` 不返回任何密文/密码字段。
