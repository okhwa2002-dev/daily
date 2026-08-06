const BASE = '/api'

/** 액세스 토큰은 메모리에만 둔다. localStorage에 저장하지 않는다. */
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

function withAuth(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return { ...init, headers, credentials: 'include' }
}

/** 리프레시 쿠키로 액세스 토큰을 재발급받는다. 성공하면 true. */
async function refresh(): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    accessToken = null
    return false
  }
  const body = (await res.json()) as { accessToken: string }
  accessToken = body.accessToken
  return true
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, withAuth(init))

  // refresh 요청 자체는 재시도하지 않는다. 재귀에 빠진다.
  if (res.status !== 401 || path.startsWith('/auth/refresh')) return res

  if (!(await refresh())) return res
  return fetch(`${BASE}${path}`, withAuth(init))
}
