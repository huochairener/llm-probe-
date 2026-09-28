# LLM Probe — 模型连通性测试工具

一个本地桌面级工具，输入 `baseUrl / apiKey / 协议 / 模型 id` 测试 LLM 模型是否响应。支持单模型调试（流式输出）与同 apiKey 下多模型批量测试。本地口令门禁，配置加密存储。

## 功能

- **四种协议**：OpenAI 兼容（`/v1/chat/completions`）、Anthropic（`/v1/messages`）、Ollama（`/api/chat`）、自定义 HTTP
- **单模型调试**：流式输出、状态码/耗时/tokens 显示、可调参数（temperature/topP/maxTokens/stream）、停止按钮
- **批量测试**：从 baseUrl 拉取模型列表（或手动填写）、勾选、并发执行、结果网格（绿✓/红✗/黄⏳）、详情面板
- **口令门禁**：首次启动设置口令，之后用口令解锁，会话仅内存（退出即失效）
- **加密存储**：apiKey 经 scrypt 派生密钥后 AES-256-GCM 加密，无口令无法解密
- **配置管理**：多组配置可保存复用，改密时自动重加密所有 apiKey

## 快速开始

### 开发模式（热重载）

```bash
pnpm install
pnpm dev
```

自动起前后端开发服务器并打开浏览器到 http://localhost:5173

- 前端 Vite dev：http://localhost:5173（热重载）
- 后端 Fastify dev：http://localhost:3173（tsx watch）
- Vite proxy 转发 `/api/*` 到后端

### 生产模式（单端口）

```bash
pnpm build
pnpm start
```

- 构建后端（tsc → `server/dist/`）+ 前端（vite build → `web/dist/`）
- 后端挂 `@fastify/static` 服务前端静态文件，单端口 http://localhost:3173 对外
- SPA fallback 到 `index.html`

## 使用说明

1. 首次启动：设置访问口令（至少 4 位），口令同时用于加密 apiKey，请记牢
2. 解锁后：左侧「新建配置」创建服务商接入点（填 baseUrl/apiKey/协议/模型）
3. 单模型调试：选配置 → 填模型 id（可「拉取列表」）→ 调参数 → 发送，看流式输出
4. 批量测试：切到「批量测试」tab → 拉取模型列表 → 勾选 → 设并发数 → 开始
5. 改密：登录页「修改口令」（会自动重加密所有配置的 apiKey）
6. 数据存储位置：`server/data/settings.json` 和 `server/data/configs.json`

## 数据与安全

| 文件 | 内容 |
|------|------|
| `server/data/settings.json` | 口令 hash（scrypt，不可逆） |
| `server/data/configs.json` | 配置列表（apiKey 字段为 AES-256-GCM 密文） |

- 口令永远不会明文存盘，只存 scrypt hash
- apiKey 加密密钥由口令派生（scrypt），无口令无法解密
- 会话 token 仅在内存中，退出应用即失效
- 所有请求经后端发起，apiKey 不进前端进程

## 技术栈

- **后端**：Node 22、Fastify 4、undici、p-limit
- **前端**：React 18、Vite 5、Tailwind CSS 3、zustand
- **加密**：Node `crypto`（scrypt + AES-256-GCM）

## 目录结构

```
llm-probe/
├─ server/                # Node 后端
│  ├─ src/
│  │  ├─ index.ts         # Fastify 启动 + 生产静态服务
│  │  ├─ auth.ts          # 口令/会话
│  │  ├─ config.ts        # 配置 CRUD
│  │  ├─ storage.ts       # 加密存储
│  │  ├─ routes.ts        # 路由（auth/config/test/batch）
│  │  ├─ test-runner.ts   # 单测/批量并发
│  │  └─ provider/        # 四种协议适配器
│  │     ├─ index.ts      # Provider 接口 + 工厂
│  │     ├─ openai.ts
│  │     ├─ anthropic.ts
│  │     ├─ ollama.ts
│  │     └─ custom.ts
│  └─ data/               # 运行时配置（gitignored）
└─ web/                   # React 前端
   ├─ src/
   │  ├─ App.tsx          # 路由守卫
   │  ├─ pages/           # Login / SingleTest / BatchTest
   │  ├─ components/       # MainLayout / ConfigForm / Sliders
   │  └─ lib/             # api / store / types
   └─ vite.config.ts
```

## 注意事项

- 这是**本地个人工具**，不要暴露到公网（只绑 127.0.0.1）
- 口令丢失后所有 apiKey 不可恢复（设计如此，保证安全）
- Ollama 协议不需要 apiKey，但仍需填写（可填任意值）
- 自定义协议支持 `{{prompt}} {{model}} {{temperature}} {{maxTokens}} {{topP}} {{stream}}` 占位符
- 流式输出在 dev 模式经 Vite proxy，生产模式直接 Fastify SSE

## 打包成单 exe

一条命令生成免安装的单文件 Windows 可执行程序（Node SEA）：

```bash
pnpm build:exe
```

产物：`dist/LLM-Probe.exe`（约 83 MB，内置 Node 运行时 + 前端静态资源，无需装 Node）。

- **双击即用**：默认监听 `http://127.0.0.1:3173`，自动打开浏览器；端口被占用时自动顺延（3173-3192）
- **数据目录**：exe 同级的 `data/`（`settings.json` 存口令 hash，`configs.json` 存加密后的 apiKey）。移动 exe 时把 `data/` 一起搬即可
- **退出**：关闭弹出的控制台窗口，或在窗口里按 `Ctrl+C`
- **环境变量**：`PORT` 指定端口、`NO_OPEN=1` 禁止自动开浏览器

打包流程（`build/make-exe.mjs`）：

1. `pnpm -r build` → 构建 server(tsc) + web(vite)
2. `esbuild` 把 `server/dist/index.js` 连同依赖打成单文件 CJS（SEA 入口只支持 CommonJS）
3. `sea-config.json` 把 `web/dist` 全部静态资源登记为内嵌 assets
4. `node --experimental-sea-config` 生成 `sea-prep.blob`
5. 复制 `node.exe` 并用 `postject` 注入 blob → `dist/LLM-Probe.exe`

> 注入后 Windows 数字签名会失效（postject 提示 “signature seems corrupted”），不影响本地运行；若分发会被 SmartScreen 拦，自行签名即可。

开发/服务方式：`pnpm dev`（热重载）或 `pnpm build && pnpm start`（单端口 3173，依赖本机 Node）。
