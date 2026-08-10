import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/pool.ts'
import { refreshTokens, users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { resetDb } from '../db/testing.ts'
import { AppError } from '../errors.ts'
import {
  issueAccessToken, issueRefreshToken, revokeRefreshToken,
  rotateRefreshToken, verifyAccessToken,
} from './tokens.ts'

async function createUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    email, passwordHash: 'h', status: 'ACTIVE',
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
})
