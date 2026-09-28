const SESSION_KEY = 'llm-probe-session'

export function getToken(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(SESSION_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(SESSION_KEY)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { 'x-session': token } : {}
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  })

  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('会话已失效')
  }

  const data = await res.json()
  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: 'GET' }),
  post: <T>(url: string, body?: any) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: <T>(url: string, body?: any) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body || {}) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' })
}

// SSE 流式请求（POST）— 返回 AbortController 用于取消
export function streamSSE(
  url: string,
  body: any,
  onEvent: (event: string, data: any) => void,
  onError?: (e: Error) => void,
  onFinally?: () => void
): AbortController {
  const controller = new AbortController()

  ;(async () => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (e: any) {
      if (e.name !== 'AbortError') onError?.(e)
      onFinally?.()
      return
    }

    if (res.status === 401) {
      clearToken()
      window.location.reload()
      onFinally?.()
      return
    }
    if (!res.ok) {
      try {
        const err = await res.json()
        onError?.(new Error(err.error || `HTTP ${res.status}`))
      } catch {
        onError?.(new Error(`HTTP ${res.status}`))
      }
      onFinally?.()
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let curEvent = 'message'

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event:')) {
            curEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim()
            if (!dataStr) continue
            try {
              onEvent(curEvent, JSON.parse(dataStr))
            } catch {
              // 非 JSON，跳过
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') onError?.(e)
    }

    onFinally?.()
  })()

  return controller
}
