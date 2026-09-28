import { useState } from 'react'
import { useStore } from '../lib/store'
import type { Config } from '../lib/types'
import ConfigForm from './ConfigForm'
import SingleTest from '../pages/SingleTest'
import BatchTest from '../pages/BatchTest'

const PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  custom: 'Custom'
}

export default function MainLayout() {
  const { configs, currentConfigId, currentTab, selectConfig, setTab, logout, loadConfigs } = useStore()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Config | null>(null)

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit() {
    const cfg = configs.find((c) => c.id === currentConfigId)
    setEditing(cfg || null)
    setFormOpen(true)
  }

  function handleSaved() {
    loadConfigs()
  }

  const selected = configs.find((c) => c.id === currentConfigId)

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <span className="text-lg font-bold text-slate-800">LLM Probe</span>
        </div>

        {/* Tab 切换 */}
        <div className="flex bg-slate-100 rounded-lg p-1">
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${currentTab === 'single' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setTab('single')}
          >单模型调试</button>
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${currentTab === 'batch' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setTab('batch')}
          >批量测试</button>
        </div>

        <button className="btn btn-secondary text-sm" onClick={logout}>退出登录</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧栏 */}
        <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-200">
            <button className="btn btn-primary w-full" onClick={openNew}>＋ 新建配置</button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {configs.length === 0 && (
              <p className="text-center text-slate-400 text-xs py-8 px-2">尚无配置<br />点击上方按钮新建</p>
            )}
            {configs.map((cfg) => (
              <button key={cfg.id}
                onClick={() => selectConfig(cfg.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition ${currentConfigId === cfg.id ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate flex-1">{cfg.name}</span>
                  <span className={`badge badge-${cfg.protocol}`}>{PROTOCOL_LABEL[cfg.protocol]}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">{cfg.baseUrl}</div>
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-slate-200">
            <button className="btn btn-secondary w-full text-sm disabled:opacity-40"
              onClick={openEdit} disabled={!selected}>
              ⚙ 编辑当前配置
            </button>
          </div>
        </aside>

        {/* 主区 */}
        <main className="flex-1 overflow-auto bg-slate-50">
          {!selected ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-slate-400 text-lg mb-2">未选择配置</p>
                <p className="text-slate-400 text-sm">请在左侧选择或新建一个配置</p>
              </div>
            </div>
          ) : currentTab === 'single' ? (
            <SingleTest />
          ) : (
            <BatchTest />
          )}
        </main>
      </div>

      <ConfigForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
    </div>
  )
}
