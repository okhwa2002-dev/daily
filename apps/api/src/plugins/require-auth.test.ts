import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.ts'
import { db, pool } from '../db/pool.ts'
import { users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { resetDb } from '../db/testing.ts'
import { issueAccessToken } from '../auth/tokens.ts'
import { requireAuth } from './require-auth.ts'

let app: FastifyInstance
/** status·deleted_at 조합별 사용자 id */
const uid: Record<string, number> = {}

async function makeUser(
  email: string,
  status: string,
  deleted = false,
): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    email, passwordHash: 'h', status,
    deletedAt: deleted ? now : null,
    deletedBy: deleted ? 0 : null,
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

beforeAll(async () => {
  await resetDb()
  uid.active = await makeUser('active@example.com', 'ACTIVE')
  uid.suspended = await makeUser('suspended@example.com', 'SUSPENDED')
  uid.pending = await makeUser('pending@example.com', 'PENDING_DELETION')
  uid.deleted = await makeUser('deleted@example.com', 'ACTIVE', true)

  app = await buildApp()
  app.get('/protected', { preHandler: requireAuth }, async (req) => ({ userId: req.userId }))
  app.get('/rate-limited', {
    config: { rateLimit: { max: 1, timeWindow: '1 minute' } },
  }, async () => ({ ok: true }))
  await app.ready()
})

afterAll(async () => { await app.close(); await pool.end() })

async function get(token?: string) {
  return app.inject({
    method: 'GET', url: '/protected',
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  })
}

describe('requireAuth', () => {
  it('유효한 토큰이면 userId를 주입한다', async () => {
    const res = await get(await issueAccessToken(uid.active!))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: uid.active })
  })

  it('토큰이 없으면 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('Bearer 형식이 아니면 401을 반환한다', async () => {
    const token = await issueAccessToken(uid.active!)
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { authorization: token },
    })
    expect(res.statusCode).toBe(401)
  })

  it('위조된 토큰은 401을 반환한다', async () => {
    const res = await get('아무렇게나.만든.토큰')
    expect(res.statusCode).toBe(401)
  })

  // --- 계정 상태 ---
  // 토큰 서명만 검사하면 정지·탈퇴가 토큰 만료까지(최대 15분) 무효가 된다.

  it('정지된 계정은 서명이 유효해도 막는다', async () => {
    const res = await get(await issueAccessToken(uid.suspended!))
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('ACCOUNT_INACTIVE')
  })

  it('탈퇴 요청된 계정은 막는다', async () => {
    const res = await get(await issueAccessToken(uid.pending!))
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('ACCOUNT_INACTIVE')
  })

  it('소프트 삭제된 계정은 status가 ACTIVE여도 막는다', async () => {
    const res = await get(await issueAccessToken(uid.deleted!))
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('ACCOUNT_INACTIVE')
  })

  it('존재하지 않는 사용자의 토큰은 401을 반환한다', async () => {
    // 서명은 유효하지만 계정이 파기된 경우
    const res = await get(await issueAccessToken(999999))
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('발급 이후 정지되면 같은 토큰이 즉시 막힌다', async () => {
    const token = await issueAccessToken(uid.active!)
    expect((await get(token)).statusCode).toBe(200)

    await db.update(users).set({ status: 'SUSPENDED' })
      .where(eq(users.id, uid.active!))
    try {
      expect((await get(token)).statusCode).toBe(403)
    } finally {
      await db.update(users).set({ status: 'ACTIVE' })
        .where(eq(users.id, uid.active!))
    }
  })

  it('rate limit에 걸려도 에러 응답 형식이 같다', async () => {
    const first = await app.inject({ method: 'GET', url: '/rate-limited' })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({ method: 'GET', url: '/rate-limited' })
    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('RATE_LIMITED')
    expect(second.json().error.requestId).toBeTruthy()
  })
})
