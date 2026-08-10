import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.ts'
import { pool } from '../db/pool.ts'
import { resetDb } from '../db/testing.ts'
import { REFRESH_COOKIE_NAME } from '../auth/tokens.ts'

let app: FastifyInstance

beforeAll(async () => { app = await buildApp(); await app.ready() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await app.close(); await pool.end() })

const CREDENTIALS = { email: 'user@example.com', password: '충분히 긴 비밀번호' }

function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  if (!cookie) throw new Error('리프레시 쿠키가 없습니다')
  return cookie.value
}

describe('POST /api/auth/register', () => {
  it('가입에 성공하면 액세스 토큰과 리프레시 쿠키를 준다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })

    expect(res.statusCode).toBe(201)
    expect(res.json().accessToken).toBeTruthy()
    expect(res.json().user.email).toBe('user@example.com')
    expect(res.json().user.passwordHash).toBeUndefined()

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
  })

  it('이메일 대소문자를 구분하지 않고 중복을 막는다', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { ...CREDENTIALS, email: 'USER@example.com' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('EMAIL_ALREADY_EXISTS')
  })

  it('짧은 비밀번호는 거부한다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { email: 'a@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })
  })

  it('올바른 자격증명으로 로그인한다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: CREDENTIALS })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
  })

  it('틀린 비밀번호와 없는 계정의 응답이 구분되지 않는다', async () => {
    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { ...CREDENTIALS, password: '틀린 비밀번호입니다' },
    })
    const noAccount = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: '아무 비밀번호나 입력' },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(noAccount.statusCode).toBe(401)
    expect(wrongPassword.json().error.code).toBe(noAccount.json().error.code)
    expect(wrongPassword.json().error.message).toBe(noAccount.json().error.message)
  })
})

describe('POST /api/auth/refresh', () => {
  it('쿠키로 새 액세스 토큰과 새 리프레시 쿠키를 받는다', async () => {
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: CREDENTIALS,
    })
    const first = refreshCookie(registered)

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: first },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
    expect(refreshCookie(res)).not.toBe(first)
  })

  it('쿠키가 없으면 401을 반환한다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('로그아웃하면 리프레시 토큰이 폐기되고 쿠키가 지워진다', async () => {
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: CREDENTIALS,
    })
    const token = refreshCookie(registered)

    const res = await app.inject({
      method: 'POST', url: '/api/auth/logout',
      cookies: { [REFRESH_COOKIE_NAME]: token },
    })
    expect(res.statusCode).toBe(204)

    const reused = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: token },
    })
    expect(reused.statusCode).toBe(401)
  })
})
