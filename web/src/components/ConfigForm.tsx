import { useState, useEffect } from 'react'
import type { Config, ConfigInput, Protocol, TestParams } from '../lib/types'
import { api } from '../lib/api'

interface Props {
  open: boolean
  editing?: Config | null
  onClose: () => void
  onSaved: () => void
}

const PROTOCOL_PLACEHOLDERS: Record<Protocol, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434',
  custom: 'https://api.example.com'
}

const DEFAULT_PARAMS: TestParams = {
  temperature: 1,
  maxTokens: 1024,
  topP: null,
  stream: true
}

export default function ConfigForm({ open, editing, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ConfigInput>({
    name: '',
    protocol: 'openai',
    baseUrl: '',
    apiKey: '',
    modelId: '',
    prompt: '你好',
    params: { ...DEFAULT_PARAMS },
    customHeaders: {},
    customBodyTemplate: ''
  })
  const [apiKeyTouched, setApiKeyTouched] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [headerKey, setHeaderKey] = useState('')
  const [headerVal, setHeaderVal] = useState('')

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          name: editing.name,
          protocol: editing.protocol,
          baseUrl: editing.baseUrl,
          apiKey: '',
          modelId: editing.modelId,
          prompt: editing.prompt,
          params: { ...editing.params },
          customHeaders: { ...editing.customHeaders },
          customBodyTemplate: editing.customBodyTemplate || ''
        })
        setApiKeyTouched(false)
      } else {
        setForm({
          name: '',
          protocol: 'openai',
          baseUrl: '',
          apiKey: '',
          modelId: '',
          prompt: '你好',
          params: { ...DEFAULT_PARAMS },
          customHeaders: {},
          customBodyTemplate: ''
        })
        setApiKeyTouched(false)
      }
      setError('')
    }
  }, [open, editing])

  if (!open) return null

  function setField<K extends keyof ConfigInput>(key: K, value: ConfigInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setParam(key: keyof TestParams, value: number | boolean | null) {
    setForm((f) => ({ ...f, params: { ...f.params, [key]: value } }))
  }

  function addHeader() {
    if (!headerKey.trim()) return
    setForm((f) => ({
      ...f,
      customHeaders: { ...f.customHeaders, [headerKey.trim()]: headerVal }
    }))
    setHeaderKey('')
    setHeaderVal('')
  }

  function removeHeader(key: string) {
    setForm((f) => {
      const next = { ...f.customHeaders }
      delete next[key]
      return { ...f, customHeaders: next }
    })
  }

  function sanitizeParams(): TestParams {
    const sanitizeNumber = (value: number | null | undefined): number | null => {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }
    return {
      temperature: sanitizeNumber(form.params.temperature),
      maxTokens: sanitizeNumber(form.params.maxTokens),
      topP: sanitizeNumber(form.params.topP),
      stream: form.params.stream
    }
  }

  async function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('请填写配置名称'); return }
    if (!form.baseUrl.trim()) { setError('请填写 Base URL'); return }
    if (!editing && !form.apiKey.trim()) { setError('请填写 API Key'); return }

    setSaving(true)
    try {
      if (editing) {
        // 编辑：apiKey 为空表示不变
        const payload: any = { ...form, params: sanitizeParams() }
        if (!form.apiKey.trim()) {
          delete payload.apiKey
        }
        await api.put(`/api/configs/${editing.id}`, payload)
      } else {
        await api.post('/api/configs', { ...form, params: sanitizeParams() })
      }
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    if (!confirm(`确认删除配置「${editing.name}」？`)) return
    try {
      await api.del(`/api/configs/${editing.id}`)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const isCustom = form.protocol === 'custom'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)' }} onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-slate-800">{editing ? '编辑配置' : '新建配置'}</h2>
          <button className="text-slate-400 hover:text-slate-600 text-xl" onClick={onClose}>×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">配置名称 <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="如：DeepSeek-主账号" />
          </div>

          {/* 协议 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">协议</label>
            <select className="input" value={form.protocol} onChange={(e) => setField('protocol', e.target.value as Protocol)}>
              <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
              <option value="anthropic">Anthropic（/v1/messages）</option>
              <option value="ollama">Ollama（/api/chat）</option>
              <option value="custom">自定义 HTTP</option>
            </select>
          </div>

          {/* BaseUrl */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Base URL <span className="text-red-500">*</span></label>
            <input className="input" value={form.baseUrl} onChange={(e) => setField('baseUrl', e.target.value)} placeholder={PROTOCOL_PLACEHOLDERS[form.protocol]} />
          </div>

          {/* ApiKey */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              API Key {editing ? <span className="text-slate-400 font-normal">（不变则留空）</span> : <span className="text-red-500">*</span>}
            </label>
            <input className="input" type="password" value={form.apiKey}
              onChange={(e) => { setField('apiKey', e.target.value); setApiKeyTouched(true) }}
              placeholder={editing ? '••••••••（留空表示不修改）' : 'sk-...'} />
          </div>

          {/* 默认模型 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">默认模型 ID <span className="text-slate-400 font-normal">（可选，批量测试时也可从 BaseURL 拉取）</span></label>
            <input className="input" value={form.modelId} onChange={(e) => setField('modelId', e.target.value)} placeholder="如：deepseek-chat" />
          </div>

          {/* 测试 Prompt */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">测试 Prompt</label>
            <textarea className="input" rows={2} value={form.prompt} onChange={(e) => setField('prompt', e.target.value)} />
          </div>

          {/* 参数 */}
          <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50">
            <p className="text-sm font-medium text-slate-700">请求参数</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Temperature <span className="text-slate-400">（留空=不发送；部分模型只允许 1）</span></label>
                <input type="number" min={0} max={2} step={0.1}
                  value={form.params.temperature == null ? '' : form.params.temperature}
                  onChange={(e) => setParam('temperature', e.target.value === '' ? null : parseFloat(e.target.value))}
                  placeholder="不发送" className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Top P <span className="text-slate-400">（留空=不发送）</span></label>
                <input type="number" min={0} max={1} step={0.05}
                  value={form.params.topP == null ? '' : form.params.topP}
                  onChange={(e) => setParam('topP', e.target.value === '' ? null : parseFloat(e.target.value))}
                  placeholder="不发送" className="input" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Max Tokens <span className="text-slate-400">（留空=不发送）</span></label>
                <input type="number" min={1} max={8192}
                  value={form.params.maxTokens == null ? '' : form.params.maxTokens}
                  onChange={(e) => setParam('maxTokens', e.target.value === '' ? null : parseInt(e.target.value))}
                  placeholder="不发送" className="input" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.params.stream}
                    onChange={(e) => setParam('stream', e.target.checked)} className="w-4 h-4" />
                  流式输出（stream）
                </label>
              </div>
            </div>
          </div>

          {/* 自定义协议额外字段 */}
          {isCustom && (
            <div className="border border-purple-200 rounded-lg p-4 space-y-3 bg-purple-50">
              <p className="text-sm font-medium text-purple-800">自定义协议配置</p>

              <div>
                <label className="block text-xs text-slate-600 mb-1">自定义请求头（Headers）</label>
                <div className="flex gap-2 mb-2">
                  <input className="input flex-1" placeholder="Header 名" value={headerKey} onChange={(e) => setHeaderKey(e.target.value)} />
                  <input className="input flex-1" placeholder="值" value={headerVal} onChange={(e) => setHeaderVal(e.target.value)} />
                  <button className="btn btn-secondary px-3" onClick={addHeader}>+</button>
                </div>
                {Object.entries(form.customHeaders).length > 0 && (
                  <div className="space-y-1">
                    {Object.entries(form.customHeaders).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-slate-600">{k}:</span>
                        <span className="text-slate-700 flex-1 truncate">{v}</span>
                        <button className="text-red-500 hover:text-red-700" onClick={() => removeHeader(k)}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-600 mb-1">自定义请求体模板（Body Template）</label>
                <textarea className="input font-mono text-xs" rows={4} value={form.customBodyTemplate}
                  onChange={(e) => setField('customBodyTemplate', e.target.value)}
                  placeholder={'可选，留空则用 OpenAI 格式。支持占位符:\n{{prompt}} {{model}} {{temperature}} {{maxTokens}} {{topP}} {{stream}}'} />
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
          <div>
            {editing && (
              <button className="btn btn-danger" onClick={handleDelete}>删除</button>
            )}
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
