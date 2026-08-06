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

/**
 * 인증 전 요청. 401이 나도 refresh를 시도하지 않는다.
 * 쿼리스트링이 붙을 수 있으므로 경로만 잘라서 정확히 비교한다.
 */
const PRE_AUTH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh'])

function pathnameOf(path: string): string {
  const q = path.indexOf('?')
  return q === -1 ? path : path.slice(0, q)
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, withAuth(init))

  // 인증 전 요청의 401은 "자격증명이 틀렸다"는 뜻이지 "토큰이 만료됐다"가 아니다.
  // 여기서 refresh를 시도하면, 같은 기기에 다른 계정의 리프레시 쿠키가 살아 있을 때
  // 그 세션의 액세스 토큰이 조용히 들어앉는다. 화면은 로그인 실패로 보이는데
  // apiClient만 남의 세션 토큰을 들고 있는 상태가 되고, 이후 요청이 그 토큰으로 나간다.
  if (res.status !== 401 || PRE_AUTH_PATHS.has(pathnameOf(path))) return res

  if (!(await refresh())) return res
  return fetch(`${BASE}${path}`, withAuth(init))
}
