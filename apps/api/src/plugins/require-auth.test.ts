import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.ts'
import { pool } from '../db/pool.ts'
import { issueAccessToken } from '../auth/tokens.ts'
import { requireAuth } from './require-auth.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  app.get('/protected', { preHandler: requireAuth }, async (req) => ({ userId: req.userId }))
  await app.ready()
})

afterAll(async () => { await app.close(); await pool.end() })

describe('requireAuth', () => {
  it('유효한 토큰이면 userId를 주입한다', async () => {
    const token = await issueAccessToken(7)
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: 7 })
  })

  it('토큰이 없으면 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('Bearer 형식이 아니면 401을 반환한다', async () => {
    const token = await issueAccessToken(7)
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { authorization: token },
    })
    expect(res.statusCode).toBe(401)
  })

  it('위조된 토큰은 401을 반환한다', async () => {
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { authorization: 'Bearer 아무렇게나.만든.토큰' },
    })
    expect(res.statusCode).toBe(401)
  })
})
