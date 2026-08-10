import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../db/pool.ts'
import { refreshTokens, users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { resetDb, testLoginId } from '../db/testing.ts'
import { AppError } from '../errors.ts'
import {
  issueAccessToken, issueRefreshToken, revokeRefreshToken,
  rotateRefreshToken, verifyAccessToken,
} from './tokens.ts'

async function createUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    loginId: testLoginId(email), email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('액세스 토큰', () => {
  it('발급한 토큰에서 userId를 되찾는다', async () => {
    const token = await issueAccessToken(42)
    expect(await verifyAccessToken(token)).toBe(42)
  })

  it('위조된 토큰은 거부한다', async () => {
    const token = await issueAccessToken(42)
    const tampered = `${token.slice(0, -3)}abc`
    await expect(verifyAccessToken(tampered)).rejects.toThrow(AppError)
  })
})

describe('리프레시 토큰', () => {
  it('평문 토큰은 DB에 저장되지 않는다', async () => {
    const userId = await createUser('a@example.com')
    const raw = await issueRefreshToken(userId)

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).not.toBe(raw)
    expect(rows[0]?.tokenHash).toHaveLength(64) // sha256 hex
  })

  it('로테이션하면 새 토큰이 나오고 이전 토큰은 폐기된다', async () => {
    const userId = await createUser('b@example.com')
    const first = await issueRefreshToken(userId)

    const rotated = await rotateRefreshToken(first)
    expect(rotated.userId).toBe(userId)
    expect(rotated.token).not.toBe(first)

    // 이전 토큰으로는 더 이상 로테이션할 수 없다
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)
  })

  it('폐기된 토큰이 재사용되면 해당 사용자의 모든 토큰을 무효화한다', async () => {
    const userId = await createUser('c@example.com')
    const first = await issueRefreshToken(userId)
    const second = await rotateRefreshToken(first)

    // 탈취된 옛 토큰이 다시 들어온 상황
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)

    // 정상 사용자가 들고 있던 최신 토큰도 함께 무효화되어야 한다
    await expect(rotateRefreshToken(second.token)).rejects.toThrow(AppError)
  })

  it('알 수 없는 토큰은 거부한다', async () => {
    await expect(rotateRefreshToken('존재하지-않는-토큰')).rejects.toThrow(AppError)
  })

  it('폐기한 토큰으로는 로테이션할 수 없다', async () => {
    const userId = await createUser('d@example.com')
    const raw = await issueRefreshToken(userId)
    await revokeRefreshToken(raw)
    await expect(rotateRefreshToken(raw)).rejects.toThrow(AppError)
  })

  it('동시에 같은 토큰으로 로테이션하면 하나만 성공한다', async () => {
    const userId = await createUser('e@example.com')
    const raw = await issueRefreshToken(userId)

    // 커넥션 풀에 유휴 커넥션을 두 개 미리 준비해 둔다. 그렇지 않으면 한쪽
    // 호출이 새 커넥션을 맺는 지연(핸드셰이크) 때문에 우연히 순서가 벌어져
    // 경쟁이 가려진다 — 그 경우 이 테스트는 고친 코드든 안 고친 코드든
    // 우연히 통과해버려 회귀를 잡아내지 못한다.
    await Promise.all([db.execute(sql`select 1`), db.execute(sql`select 1`)])

    const results = await Promise.allSettled([
      rotateRefreshToken(raw),
      rotateRefreshToken(raw),
    ])

    // 선점이 없으면 둘 다 성공하고 옛 토큰이 살아남는다 — 재사용 탐지가 무력화된다.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
})

describe('revoked_by 기록', () => {
  async function revokedByOf(raw: string): Promise<number | null> {
    const [row] = await db.select({ revokedBy: refreshTokens.revokedBy })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, createHash('sha256').update(raw).digest('hex')))
    return row?.revokedBy ?? null
  }

  it('로테이션으로 폐기하면 토큰 주인이 행위자로 남는다', async () => {
    const userId = await createUser('f@example.com')
    const raw = await issueRefreshToken(userId)
    await rotateRefreshToken(raw)
    expect(await revokedByOf(raw)).toBe(userId)
  })

  it('로그아웃으로 폐기하면 토큰 주인이 행위자로 남는다', async () => {
    const userId = await createUser('g@example.com')
    const raw = await issueRefreshToken(userId)
    await revokeRefreshToken(raw)
    expect(await revokedByOf(raw)).toBe(userId)
  })

  it('재사용 탐지로 강제 폐기하면 시스템 sentinel 0이 남는다', async () => {
    const userId = await createUser('h@example.com')
    const first = await issueRefreshToken(userId)
    const second = await rotateRefreshToken(first)

    // 탈취된 옛 토큰 재사용 → second가 강제 폐기된다
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)

    expect(await revokedByOf(second.token)).toBe(0)
  })
})
