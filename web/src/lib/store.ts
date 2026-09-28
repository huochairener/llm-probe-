import { create } from 'zustand'
import type { Config, TabKey } from './types'
import { api, clearToken } from './api'

interface AppState {
  // 会话
  initialized: boolean
  unlocked: boolean
  sessionToken: string | null

  // 当前状态
  currentTab: TabKey
  currentConfigId: string | null
  configs: Config[]

  // 动作
  setStatus: (initialized: boolean, unlocked: boolean) => void
  setSession: (token: string) => void
  logout: () => Promise<void>
  setTab: (tab: TabKey) => void
  selectConfig: (id: string | null) => void
  loadConfigs: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  initialized: false,
  unlocked: false,
  sessionToken: null,
  currentTab: 'single',
  currentConfigId: null,
  configs: [],

  setStatus: (initialized, unlocked) => set({ initialized, unlocked }),

  setSession: (token) => set({ sessionToken: token, unlocked: true }),

  logout: async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // 忽略
    }
    clearToken()
    set({ unlocked: false, sessionToken: null, configs: [], currentConfigId: null })
  },

  setTab: (tab) => set({ currentTab: tab }),

  selectConfig: (id) => set({ currentConfigId: id }),

  loadConfigs: async () => {
    try {
      const data = await api.get<{ list: Config[] }>('/api/configs')
      const list = data.list || []
      const cur = get().currentConfigId
      // 如果当前选中的配置不存在了，选第一个
      if (!cur || !list.find((c) => c.id === cur)) {
        set({ configs: list, currentConfigId: list[0]?.id || null })
      } else {
        set({ configs: list })
      }
    } catch {
      // 忽略
    }
  }
}))
