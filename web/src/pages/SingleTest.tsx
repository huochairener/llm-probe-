import { useState, useRef, useEffect } from 'react'
import { useStore } from '../lib/store'
import { api, streamSSE } from '../lib/api'
import type { TestParams, TestResult } from '../lib/types'
import Slider from '../components/Sliders'
import ConfigForm from '../components/ConfigForm'

const PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama', custom: 'Custom'
}

function toFiniteNumber(text: string): number | null {
  const value = Number(text)
  return text.trim() === '' || !Number.isFinite(value) ? null : value
}

export default function SingleTest() {
  const { configs, currentConfigId, loadConfigs } = useStore()
  const cfg = configs.find((c) => c.id === currentConfigId)

  // 本地可变状态（不保存到配置，只用于本次测试）
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [params, setParams] = useState<TestParams>({ temperature: 1, maxTokens: 1024, topP: null, stream: true })
  const [modelList, setModelList] = useState<string[]>([])
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelListError, setModelListError] = useState('')

  // 测试状态
  const [content, setContent] = useState('')
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const [formOpen, setFormOpen] = useState(false)

  // 当配置切换时同步本地状态
  useEffect(() => {
    if (cfg) {
      setModelId(cfg.modelId || '')
      setPrompt(cfg.prompt || '你好')
      setParams({ ...cfg.params })
      // 清空上次结果
      setContent('')
      setResult(null)
      setError('')
      setModelList([])
      setModelListError('')
    }
  }, [currentConfigId, cfg?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 流式内容自动滚动到底部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content])

  if (!cfg) return null

  async function fetchModels() {
    if (!cfg) return
    setModelListLoading(true)
    setModelListError('')
    try {
      const data = await api.get<{ models: string[] }>(`/api/models?configId=${cfg.id}`)
      setModelList(data.models || [])
      if (data.models.length > 0 && !modelId) {
        setModelId(data.models[0])
      }
    } catch (e: any) {
      setModelListError(e.message)
      setModelList([])
    } finally {
      setModelListLoading(false)
    }
  }

  function handleSend() {
    if (!cfg || !modelId) return
    setContent('')
    setResult(null)
    setError('')
    setRunning(true)

    controllerRef.current = streamSSE(
      '/api/test/single',
      { configId: cfg.id, modelId, prompt, params },
      (event, data) => {
        if (event === 'chunk') {
          setContent((c) => c + (data.delta || ''))
        } else if (event === 'done' || event === 'result') {
          setResult(data as TestResult)
          if (data.content && !content) setContent(data.content)
        } else if (event === 'error') {
          setError(data.message || '未知错误')
        }
      },
      (e) => {
        setError(e.message)
        setRunning(false)
      },
      () => {
        setRunning(false)
      }
    )
  }

  function handleStop() {
    controllerRef.current?.abort()
    setRunning(false)
  }

  // 状态码颜色
  const statusColor = !result ? 'text-slate-400' :
    result.status >= 200 && result.status < 300 ? 'text-emerald-600' :
    result.status === 0 ? 'text-red-600' : 'text-amber-600'

  return (
    <div className="h-full flex">
      {/* 左栏：参数面板 */}
      <div className="w-80 bg-white border-r border-slate-200 overflow-y-auto shrink-0">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-800 truncate flex-1">{cfg.name}</span>
            <span className={`badge badge-${cfg.protocol}`}>{PROTOCOL_LABEL[cfg.protocol]}</span>
          </div>
          <div className="text-xs text-slate-400 truncate">{cfg.baseUrl}</div>
          <button className="btn btn-secondary text-xs w-full mt-3" onClick={() => setFormOpen(true)}>
            ⚙ 在配置里编辑
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 模型选择 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">模型 ID</label>
              <button className="text-xs text-indigo-600 hover:underline" onClick={fetchModels} disabled={modelListLoading}>
                {modelListLoading ? '拉取中...' : '拉取列表'}
              </button>
            </div>
            {modelList.length > 0 ? (
              <select className="input" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {!modelId && <option value="">-- 选择模型 --</option>}
                {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="如 deepseek-chat" />
            )}
            {modelListError && <p className="text-xs text-red-500 mt-1">{modelListError}</p>}
          </div>

          {/* 参数 */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">参数</p>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Temperature <span className="text-slate-400">（留空=不发送；部分模型只允许 1）</span></label>
              <input type="number" step="0.1" min={0} max={2}
                value={params.temperature == null ? '' : params.temperature}
                onChange={(e) => setParams((p) => ({ ...p, temperature: toFiniteNumber(e.target.value) }))}
                placeholder="不发送" className="input" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Top P <span className="text-slate-400">（留空=不发送）</span></label>
              <input type="number" step="0.05" min={0} max={1}
                value={params.topP == null ? '' : params.topP}
                onChange={(e) => setParams((p) => ({ ...p, topP: toFiniteNumber(e.target.value) }))}
                placeholder="不发送" className="input" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Max Tokens <span className="text-slate-400">（留空=不发送）</span></label>
              <input type="number" min={1} max={8192}
                value={params.maxTokens == null ? '' : params.maxTokens}
                onChange={(e) => setParams((p) => ({ ...p, maxTokens: toFiniteNumber(e.target.value) }))}
                placeholder="不发送" className="input" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={params.stream}
                onChange={(e) => setParams((p) => ({ ...p, stream: e.target.checked }))} className="w-4 h-4" />
              流式输出（stream）
            </label>
          </div>
        </div>
      </div>

      {/* 中栏：响应区 + 底栏输入 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 状态条 */}
        <div className="flex items-center gap-4 px-4 h-10 bg-white border-b border-slate-200 shrink-0 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">状态</span>
            <span className={`font-mono font-medium ${statusColor}`}>
              {result ? (result.status === 0 ? 'ERR' : result.status) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">耗时</span>
            <span className="font-mono text-slate-600">{result ? `${result.latencyMs}ms` : '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Tokens</span>
            <span className="font-mono text-slate-600">{result?.tokens ?? '—'}</span>
          </div>
          {result?.error && (
            <span className="text-red-500 truncate flex-1">{result.error}</span>
          )}
        </div>

        {/* 响应内容 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-700">
              <p className="font-medium mb-1">测试失败</p>
              <p className="font-mono text-xs break-all">{error}</p>
            </div>
          ) : content ? (
            <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">{content}</pre>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-300 text-sm">点击下方"发送"开始测试</p>
            </div>
          )}
        </div>

        {/* 底栏输入 */}
        <div className="border-t border-slate-200 bg-white p-3 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea className="input flex-1 resize-none" rows={2} value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入测试 prompt..."
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }} />
            {running ? (
              <button className="btn btn-danger" onClick={handleStop}>■ 停止</button>
            ) : (
              <button className="btn btn-primary" onClick={handleSend} disabled={!modelId || !prompt.trim()}>
                发送
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfigForm open={formOpen} editing={cfg} onClose={() => setFormOpen(false)} onSaved={loadConfigs} />
    </div>
  )
}
