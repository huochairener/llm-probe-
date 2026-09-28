# LLM Probe — 模型连通性测试工具设计

> 状态：已批准　|　日期：2025-09-21　|　类型：桌面应用规格

## 1. 概述

一个 Tauri 桌面应用，用于测试 LLM 模型连通性。输入 baseUrl/apiKey/协议/模型id 等信息，发送测试请求，展示响应内容与元信息（状态码/耗时/token数）。支持单模型调试与同 apiKey 下多模型批量测试。本地口令门禁，配置可存储复用。

**硬约束**：占用低（运行时内存 ~50MB）、界面美观（浅色清爽风格）、个人本地使用、登录为口令门禁性质。

## 2. 技术栈

- **后端**：Node.js + Fastify — HTTP 调用、配置读写、加密存储、本地服务
- **前端**：React + TypeScript + Vite + Tailwind CSS
- **存储**：本地 JSON 配置文件（后端读写，apiKey 加密存储）
- **HTTP**：后端 `undici`（内置、并发好），批量测试用 `p-limit` 控并发
- **打包**：`pkg` 或 Node 单文件 SEA 打包成单 .exe；开发时 `concurrently` 起前后端，双击启动脚本自动开浏览器

## 3. 架构分层

```
┌─────────────────────────────────────────┐
│  前端 (React + Vite, dev 端口 5173)     │
│  ├─ 登录页                              │
│  ├─ 单模型调试页（三栏）                │
│  └─ 批量测试页（双栏网格）              │
├──────── REST/SSE (同源 fetch) ─────────┤
│  Node 后端 (Fastify, 端口 3173)        │
│  ├─ auth 模块    口令校验/会话状态       │
│  ├─ config 模块  配置CRUD + 加密存储     │
│  ├─ provider 模块 多协议适配器           │
│  │   ├─ openai.ts                       │
│  │   ├─ anthropic.ts                    │
│  │   ├─ ollama.ts                       │
│  │   └─ custom.ts                       │
│  ├─ test 模块    单测/批量(并发)         │
│  └─ storage     密钥派生+AES加密apikey   │
└─────────────────────────────────────────┘
```

**关键边界**：所有网络请求和配置读写都在后端，前端只做展示和触发。apiKey 永不明文出现在前端进程里（前端只存配置 id，apiKey 用时由后端解密）。

## 4. 数据模型

一条配置 = 一个服务商接入点（不含模型列表，模型列表运行时从 baseUrl 拉取）：

```jsonc
{
  "id": "uuid",
  "name": "DeepSeek-主账号",
  "protocol": "openai" | "anthropic" | "ollama" | "custom",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "<AES加密后的密文>",
  "modelId": "deepseek-chat",        // 单测默认模型
  "prompt": "你好",                   // 测试用 prompt
  "params": {                         // 调参滑块
    "temperature": 0.7,
    "maxTokens": 1024,
    "topP": 1.0,
    "stream": true
  },
  "customHeaders": {},               // custom 协议专用
  "customBodyTemplate": "",          // custom 协议专用
  "createdAt": 0,
  "updatedAt": 0
}
```

全局 `settings.json`：`{ "passwordHash": "...", "sessionTtlMs": ... }`。

## 5. 协议适配层（共用）

统一接口 `trait Provider`：
- `list_models(cfg) -> Vec<ModelId>` — OpenAI 走 `/models`，Anthropic 走 `/v1/models`，Ollama 走 `/api/tags`，custom 可选填一个拉取路径
- `chat(cfg, modelId, prompt, params) -> TestResult` — 统一返回 `{ status, latencyMs, tokens, content, rawRequest, rawResponse, error? }`

单模型调试和批量测试共用这一层，保证行为一致。

## 6. 登录与会话

- 首次启动：引导设置口令（输两次确认），存 `passwordHash`（Argon2）
- 之后启动：全屏登录页，输口令 → 校验 hash → 通过则本次运行记住会话（内存 `unlocked=true`），退出应用即失效
- 口令同时用于加密 apiKey 的密钥派生（scrypt 从口令派生密钥），无口令无法解密 apiKey，门禁和加密绑定
- 提供"修改口令"入口（需先解锁）

## 7. UI 结构与布局

**全局风格**：浅色清爽，背景 `#f8fafc`，主色紫蓝 `#6366f1`，卡片白底 + `1px solid #e2e8f0` + 轻投影，圆角 8-12px。

```
登录页（未解锁）：居中卡片，口令输入框 + 解锁按钮
主界面（已解锁）：
┌ 顶栏：标题 + [单模型调试] [批量测试] 标签切换 + 退出登录
├ 左侧栏（窄 220px）：配置列表（可点击切换）+ ➕新建 + ⚙设置
└ 主区：
   ├─ [单模型调试] 三栏：
   │   左(360px)：配置参数表单（baseUrl/apiKey/协议/模型/prompt/参数滑块/流式开关/raw编辑）
   │   中：响应区（状态码·耗时·token数 + 模型回复内容，支持流式追加）
   │   底：prompt输入 + [发送][停止]
   └─ [批量测试] 双栏网格：
      左(280px)：模型清单（从 baseUrl 拉取 or 手动填，复选框勾选，带状态色点）
      工具条：[刷新模型列表] [选择测试prompt] [并发数] [开始批量测试]
      右：结果网格（每模型一格：绿✓成功/红✗失败/黄⏳进行中，点开看详情）
```

## 8. 关键流程

- **单模型调试**：填表 → 点发送 → Rust 侧按协议发请求 → 流式时逐 chunk 推回前端追加显示 → 完成后显示元信息
- **批量测试**：选配置 → 左栏拉模型列表（失败则切手动填）→ 勾选要测的 → 选测试 prompt → 开始 → Rust 侧用线程池并发发请求（默认并发数=4，可调）→ 每个完成即更新对应格子状态 → 点格子看该模型详细回复
- **新建/编辑配置**：表单填写 → 保存 → apiKey 加密入库 → 列表刷新

## 9. 错误处理

- 网络错误/超时：显示"连接失败"+原始错误，状态标红，不崩溃
- 协议不匹配（如填了 openai 但实际是 anthropic）：捕获响应解析失败，提示"协议可能不正确，请检查"
- apiKey 错误（401）：明确提示"鉴权失败，检查 apiKey"
- 批量测试中单个失败不影响其他模型，各自独立标红

## 10. 测试策略

- Rust 侧：provider 适配器对真实端点写少量集成测试（用环境变量开关），其余逻辑单测
- 前端：组件级用 Vitest，重点测配置表单和批量网格状态机
- 手动验收：用真实 apiKey 跑通单测+批量

## 11. 目录结构

```
llm-probe/
├─ server/                  Node 后端 (Fastify)
│  ├─ src/
│  │  ├─ index.ts        启动服务、路由挂载
│  │  ├─ auth.ts         口令/会话
│  │  ├─ config.ts       配置CRUD
│  │  ├─ storage.ts      加密存储
│  │  ├─ provider/
│  │  │  ├─ index.ts     interface Provider
│  │  │  ├─ openai.ts
│  │  │  ├─ anthropic.ts
│  │  │  ├─ ollama.ts
│  │  │  └─ custom.ts
│  │  └─ test.ts         单测/批量
│  └─ tsconfig.json
├─ web/                    React 前端 (Vite)
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  ├─ pages/
│  │  │  ├─ Login.tsx
│  │  │  ├─ SingleTest.tsx    单模型调试
│  │  │  └─ BatchTest.tsx     批量测试
│  │  ├─ components/
│  │  ├─ lib/             fetch 封装
│  │  └─ index.css
│  ├─ vite.config.ts
│  └─ tsconfig.json
├─ package.json           workspaces
└─ pnpm-workspace.yaml
```
