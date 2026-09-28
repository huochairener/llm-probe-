import { useState, useEffect } from 'react'
import { useStore } from '../lib/store'
import { api, setToken } from '../lib/api'

type Mode = 'setup' | 'unlock' | 'changePassword'

export default function Login() {
  const { initialized, setSession, setStatus } = useStore()
  const [mode, setMode] = useState<Mode>(initialized ? 'unlock' : 'setup')

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setError('')
  }, [mode])

  async function handleSetup() {
    setError('')
    if (pw.length < 4) { setError('口令至少 4 位'); return }
    if (pw !== pw2) { setError('两次输入不一致'); return }
    setLoading(true)
    try {
      await api.post('/api/auth/setup', { password: pw })
      // 设置成功后直接解锁
      const data = await api.post<{ token: string }>('/api/auth/unlock', { password: pw })
      setToken(data.token)
      setSession(data.token)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlock() {
    setError('')
    if (!pw) { setError('请输入口令'); return }
    setLoading(true)
    try {
      const data = await api.post<{ token: string }>('/api/auth/unlock', { password: pw })
      setToken(data.token)
      setSession(data.token)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleChangePassword() {
    setError('')
    if (!oldPw || !newPw) { setError('请填写完整'); return }
    if (newPw.length < 4) { setError('新口令至少 4 位'); return }
    if (newPw !== newPw2) { setError('两次新口令不一致'); return }
    setLoading(true)
    try {
      await api.post('/api/auth/change-password', { oldPassword: oldPw, newPassword: newPw })
      setMode('unlock')
      setOldPw(''); setNewPw(''); setNewPw2('')
      setError('口令已修改，请用新口令解锁')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f8fafc 100%)' }}>
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">LLM Probe</h1>
          <p className="text-slate-500 text-sm mt-1">模型连通性测试工具</p>
        </div>

        {mode === 'setup' && (
          <div className="space-y-4">
            <p className="text-center text-sm text-slate-600 mb-2">首次使用，请设置访问口令</p>
            <input className="input" type="password" placeholder="设置口令（至少 4 位）"
              value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSetup()} />
            <input className="input" type="password" placeholder="确认口令"
              value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetup()} />
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button className="btn btn-primary w-full" onClick={handleSetup} disabled={loading}>
              {loading ? '设置中...' : '设置并进入'}
            </button>
          </div>
        )}

        {mode === 'unlock' && (
          <div className="space-y-4">
            <input className="input" type="password" placeholder="输入口令解锁"
              value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} />
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button className="btn btn-primary w-full" onClick={handleUnlock} disabled={loading}>
              {loading ? '解锁中...' : '解锁'}
            </button>
            <div className="text-center">
              <button className="text-sm text-indigo-600 hover:underline"
                onClick={() => { setMode('changePassword'); setError(''); setPw('') }}>
                修改口令
              </button>
            </div>
          </div>
        )}

        {mode === 'changePassword' && (
          <div className="space-y-4">
            <p className="text-center text-sm text-slate-600 mb-2">修改访问口令</p>
            <input className="input" type="password" placeholder="原口令"
              value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
            <input className="input" type="password" placeholder="新口令（至少 4 位）"
              value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <input className="input" type="password" placeholder="确认新口令"
              value={newPw2} onChange={(e) => setNewPw2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()} />
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <div className="flex gap-3">
              <button className="btn btn-secondary flex-1"
                onClick={() => { setMode('unlock'); setError('') }}>
                返回
              </button>
              <button className="btn btn-primary flex-1" onClick={handleChangePassword} disabled={loading}>
                {loading ? '修改中...' : '确认修改'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
