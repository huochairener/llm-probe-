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
