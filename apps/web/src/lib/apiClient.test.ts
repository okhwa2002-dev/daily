import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setAccessToken } from './apiClient.ts'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken(null)
})
afterEach(() => { vi.unstubAllGlobals() })

const ok = (body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 })

describe('apiFetch', () => {
  it('액세스 토큰을 Authorization 헤더로 보낸다', async () => {
    setAccessToken('token-abc')
    fetchMock.mockResolvedValueOnce(ok())

    await apiFetch('/expenses')

    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-abc')
  })

  it('401을 받으면 refresh 후 한 번만 재시도한다', async () => {
    setAccessToken('expired')
    fetchMock
      .mockResolvedValueOnce(unauthorized())                       // 최초 요청
      .mockResolvedValueOnce(ok({ accessToken: 'fresh', user: { id: 1, email: 'a@b.c' } })) // refresh
      .mockResolvedValueOnce(ok({ data: 'ok' }))                   // 재요청

    const res = await apiFetch('/expenses')

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, retryInit] = fetchMock.mock.calls[2]!
    expect(new Headers(retryInit.headers).get('authorization')).toBe('Bearer fresh')
  })

  it('refresh도 실패하면 재시도하지 않고 401을 그대로 돌려준다', async () => {
    setAccessToken('expired')
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/expenses')

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refresh 요청 자체는 재시도 대상이 아니다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/auth/refresh', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('로그인 실패는 refresh를 시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.c', password: '틀린 비밀번호입니다' }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('회원가입 실패도 refresh를 시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    await apiFetch('/auth/register', { method: 'POST', body: '{}' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
