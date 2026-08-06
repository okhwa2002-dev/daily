import { create } from 'zustand'
import { apiFetch, setAccessToken } from '../lib/apiClient.ts'

// TODO(Task 8): @daily/shared에 AuthResponse가 추가되면 로컬 정의를 지우고 그쪽에서 가져온다.
interface AuthResponse {
  accessToken: string
  user: { id: number; email: string }
}

type SessionStatus = 'LOADING' | 'AUTHENTICATED' | 'ANONYMOUS'

interface SessionState {
  user: { id: number; email: string } | null
  status: SessionStatus
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

async function readError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as
    { error?: { message?: string } } | null
  return new Error(body?.error?.message ?? '요청을 처리하지 못했습니다.')
}

async function authenticate(
  path: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as AuthResponse
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  status: 'LOADING',

  init: async () => {
    const res = await apiFetch('/auth/refresh', { method: 'POST' })
    if (!res.ok) {
      set({ user: null, status: 'ANONYMOUS' })
      return
    }
    const body = (await res.json()) as AuthResponse
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  login: async (email, password) => {
    const body = await authenticate('/auth/login', email, password)
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  register: async (email, password) => {
    const body = await authenticate('/auth/register', email, password)
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  logout: async () => {
    await apiFetch('/auth/logout', { method: 'POST' })
    setAccessToken(null)
    set({ user: null, status: 'ANONYMOUS' })
  },
}))
