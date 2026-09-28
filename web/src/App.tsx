import { useEffect, useState } from 'react'
import { useStore } from './lib/store'
import { api, getToken } from './lib/api'
import Login from './pages/Login'
import MainLayout from './components/MainLayout'

export default function App() {
  const { initialized, unlocked, setStatus, loadConfigs } = useStore()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ initialized: boolean }>('/api/auth/status')
        const hasToken = !!getToken()
        setStatus(data.initialized, data.initialized && hasToken)
      } catch {
        setStatus(false, false)
      } finally {
        setChecking(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (unlocked) {
      loadConfigs()
    }
  }, [unlocked])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">加载中...</p>
      </div>
    )
  }

  if (!initialized || !unlocked) {
    return <Login />
  }

  return <MainLayout />
}
