import { useState, useRef, useEffect } from 'react'
import { useStore } from '../lib/store'
import { api, streamSSE } from '../lib/api'
import type { TestResult } from '../lib/types'

const PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama', custom: 'Custom'
}

type ItemStatus = 'pending' | 'running' | 'success' | 'failed'

interface BatchItem {
  modelId: string
  status: ItemStatus
  result?: TestResult
}

export default function BatchTest() {
  const { configs, currentConfigId, loadConfigs } = useStore()
  const cfg = configs.find((c) => c.id === currentConfigId)

  const [modelList, setModelList] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [manualInput, setManualInput] = useState('')

  const [prompt, setPrompt] = useState('')
  const [concurrency, setConcurrency] = useState(4)
  const [items, setItems] = useState<BatchItem[]>([])
  const [running, setRunning] = useState(false)
  const [detail, setDetail] = useState<BatchItem | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (cfg) {
      setPrompt(cfg.prompt || '你好')
      setModelList([])
      setSelected(new Set())
      setListError('')
      setManualInput('')
      setItems([])
      setDetail(null)
    }
  }, [currentConfigId, cfg?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return null

  async function fetchModels() {
    if (!cfg) return
    setListLoading(true)
    setListError('')
    try {
      const data = await api.get<{ models: string[] }>(`/api/models?configId=${cfg.id}`)
      const list = data.models || []
      setModelList(list)
      setSelected(new Set(list)) // 默认全选
      if (list.length === 0) {
        setListError('未获取到模型列表，请手动填写')
      }
    } catch (e: any) {
      setListError(e.message)
      setModelList([])
    } finally {
      setListLoading(false)
    }
  }

  function applyManual() {
    const ids = manualInput
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    setModelList(ids)
    setSelected(new Set(ids))
    setListError('')
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(modelList))
  }
  function invertSelect() {
    setSelected((s) => {
      const next = new Set<string>()
      for (const m of modelList) if (!s.has(m)) next.add(m)
      return next
    })
  }

  function handleStart() {
    if (!cfg || selected.size === 0) return
    const modelIds = [...selected]
    const initItems: BatchItem[] = modelIds.map((id) => ({ modelId: id, status: 'pending' }))
    setItems(initItems)
    setRunning(true)
    setDetail(null)

    controllerRef.current = streamSSE(
      '/api/batch',
      { configId: cfg.id, modelIds, prompt, params: cfg.params, concurrency },
      (event, data) => {
        if (event === 'start') {
          // {total, concurrency}
        } else if (event === 'item') {
          const { modelId, result } = data as { modelId: string; result: TestResult }
          setItems((arr) => arr.map((it) =>
            it.modelId === modelId
              ? { ...it, status: result.error ? 'failed' : 'success', result }
              : it
          ))
        } else if (event === 'finished') {
          // 全部完成
        } else if (event === 'error') {
          setListError(data.message || '批量测试失败')
        }
      },
      (e) => {
        setListError(e.message)
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

  // 进度统计
  const doneCount = items.filter((it) => it.status === 'success' || it.status === 'failed').length
  const totalCount = items.length
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

  // 将手动列表与已选合并显示
  const displayList = modelList.length > 0 ? modelList : []

  return (
    <div className="h-full flex">
      {/* 左栏：模型清单 */}
      <div className="w-72 bg-white border-r border-slate-200 overflow-y-auto shrink-0 flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-slate-800 truncate flex-1">{cfg.name}</span>
            <span className={`badge badge-${cfg.protocol}`}>{PROTOCOL_LABEL[cfg.protocol]}</span>
          </div>
          <button className="btn btn-primary w-full text-sm" onClick={fetchModels} disabled={listLoading || running}>
            {listLoading ? '拉取中...' : '刷新模型列表'}
          </button>
        </div>

        {displayList.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3 text-xs">
            <button className="text-indigo-600 hover:underline" onClick={selectAll} disabled={running}>全选</button>
            <button className="text-indigo-600 hover:underline" onClick={invertSelect} disabled={running}>反选</button>
            <span className="text-slate-400">已选 {selected.size}/{displayList.length}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {displayList.length === 0 ? (
            <div className="p-2">
              <p className="text-xs text-slate-400 mb-2">未获取到列表，可手动填写（逗号或换行分隔）：</p>
              <textarea className="input text-xs" rows={4} value={manualInput}
                onChange={(e) => setManualInput(e.target.value)} disabled={running}
                placeholder="model-a&#10;model-b, model-c" />
              <button className="btn btn-secondary text-xs w-full mt-2" onClick={applyManual} disabled={running}>应用</button>
            </div>
          ) : (
            displayList.map((id) => {
              const item = items.find((it) => it.modelId === id)
              const status = item?.status
              const dotColor = status === 'success' ? 'bg-emerald-500'
                : status === 'failed' ? 'bg-red-500'
                : status === 'running' ? 'bg-amber-400 animate-pulse'
                : 'bg-slate-300'
              return (
                <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggleSelect(id)} disabled={running} className="w-3.5 h-3.5" />
                  <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                  <span className="text-xs text-slate-700 truncate flex-1 font-mono">{id}</span>
                </label>
              )
            })
          )}
        </div>
      </div>

      {/* 右栏：工具条 + 结果网格 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具条 */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">Prompt</label>
            <input className="input text-xs py-1" style={{ width: 200 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">并发</label>
            <input type="number" min={1} max={16} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(16, parseInt(e.target.value) || 4)))} className="input text-xs py-1" style={{ width: 60 }} disabled={running} />
          </div>
          <div className="flex-1" />
          {running ? (
            <button className="btn btn-danger" onClick={handleStop}>■ 停止</button>
          ) : (
            <button className="btn btn-primary" onClick={handleStart} disabled={selected.size === 0}>开始批量测试</button>
          )}
        </div>

        {/* 进度条 */}
        {(running || totalCount > 0) && (
          <div className="px-4 py-2 bg-white border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-slate-500 font-mono">{doneCount}/{totalCount}</span>
            </div>
          </div>
        )}

        {/* 结果网格 */}
        <div className="flex-1 overflow-y-auto p-4">
          {listError && !running && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-700 mb-3">{listError}</div>
          )}
          {items.length === 0 && !running ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-300 text-sm">点击"开始批量测试"运行</p>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {items.map((it) => (
                <button key={it.modelId} onClick={() => setDetail(it)}
                  className={`text-left p-3 rounded-lg border transition hover:shadow-sm ${it.status === 'success' ? 'border-emerald-200 bg-emerald-50' : it.status === 'failed' ? 'border-red-200 bg-red-50' : it.status === 'running' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {it.status === 'success' && <span className="text-emerald-600 text-sm">✓</span>}
                    {it.status === 'failed' && <span className="text-red-600 text-sm">✗</span>}
                    {it.status === 'running' && <span className="text-amber-500 text-sm">⏳</span>}
                    {it.status === 'pending' && <span className="text-slate-300 text-sm">○</span>}
                    <span className="text-xs font-mono text-slate-700 truncate flex-1">{it.modelId}</span>
                  </div>
                  {it.result && (
                    <div className="text-xs text-slate-500">
                      {it.result.error ? (
                        <span className="text-red-500 truncate">{it.result.error}</span>
                      ) : (
                        <span>{it.result.status} · {it.result.latencyMs}ms{it.result.tokens ? ` · ${it.result.tokens}tok` : ''}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 详情面板 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={() => setDetail(null)}>
          <div className="card w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 sticky top-0 bg-white">
              <h3 className="text-sm font-mono font-bold text-slate-800 truncate">{detail.modelId}</h3>
              <button className="text-slate-400 text-xl" onClick={() => setDetail(null)}>×</button>
            </div>
            {detail.result && (
              <div className="p-4 space-y-3">
                <div className="flex gap-4 text-xs">
                  <span className={detail.status === 'success' ? 'text-emerald-600' : 'text-red-600'}>
                    {detail.result.status === 0 ? 'ERR' : detail.result.status}
                  </span>
                  <span className="text-slate-500">{detail.result.latencyMs}ms</span>
                  {detail.result.tokens && <span className="text-slate-500">{detail.result.tokens} tokens</span>}
                </div>
                {detail.result.error && (
                  <div className="border border-red-200 bg-red-50 rounded p-2 text-xs text-red-700 font-mono break-all">{detail.result.error}</div>
                )}
                <div>
                  <p className="text-xs text-slate-500 mb-1">模型回复</p>
                  <pre className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 rounded p-3 text-xs">{detail.result.content || '(空)'}</pre>
                </div>
                <details>
                  <summary className="text-xs text-indigo-600 cursor-pointer">原始请求/响应</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Request</p>
                      <pre className="whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 rounded p-2 break-all overflow-x-auto">{detail.result.rawRequest}</pre>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Response</p>
                      <pre className="whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 rounded p-2 break-all overflow-x-auto max-h-60 overflow-y-auto">{detail.result.rawResponse}</pre>
                    </div>
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
