import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { toKstTimestamp } from '@daily/shared'
import { db } from '../db/pool.ts'
import { refreshTokens } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { env } from '../env.ts'
import { AppError } from '../errors.ts'

export const REFRESH_COOKIE_NAME = 'daily_rt'

const secret = new TextEncoder().encode(env.JWT_SECRET)

export async function issueAccessToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<number> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError(401, 'INVALID_TOKEN', '인증 정보가 올바르지 않습니다.')
    }
    return userId
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(401, 'INVALID_TOKEN', '인증 정보가 올바르지 않습니다.')
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function expiryTimestamp(): string {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  return toKstTimestamp(new Date(Date.now() + ms))
}

export async function issueRefreshToken(userId: number): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  const now = dbNow()
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: expiryTimestamp(),
    createdAt: now, createdBy: userId, updatedAt: now, updatedBy: userId,
  })
  return raw
}

/** 해당 사용자의 살아 있는 리프레시 토큰을 전부 폐기한다. */
async function revokeAllForUser(userId: number): Promise<void> {
  const now = dbNow()
  await db.update(refreshTokens)
    // 재사용 탐지에 의한 강제 폐기는 시스템 행위다. sentinel 0을 남겨
    // 사용자가 스스로 로그아웃한 경우와 구분한다.
    .set({ revokedAt: now, revokedBy: 0, updatedAt: now, updatedBy: userId })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
}

export async function rotateRefreshToken(
  raw: string,
): Promise<{ userId: number; token: string }> {
  const hash = hashToken(raw)
  const now = dbNow()

  // 살아 있는 토큰을 UPDATE 한 번으로 선점한다.
  //
  // 조회 후 갱신으로 나누면 TOCTOU가 생긴다. 같은 옛 토큰을 든 요청 두 개가
  // 동시에 들어오면 둘 다 `revoked_at IS NULL`을 읽고 각자 새 토큰을 발급받으며,
  // 옛 토큰은 살아남는다. 재사용 탐지는 아무것도 감지하지 못한다 — 이 태스크가
  // 제공하기로 한 바로 그 보장이 조용히 사라진다.
  // `WHERE revoked_at IS NULL`을 UPDATE에 넣으면 경쟁에서 정확히 하나만 이긴다.
  const [claimed] = await db.update(refreshTokens)
    .set({
      revokedAt: now,
      revokedBy: sql`${refreshTokens.userId}`,
      updatedAt: now,
      updatedBy: sql`${refreshTokens.userId}`,
    })
    .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
    .returning()

  if (!claimed) {
    // 선점 실패 — 없는 토큰이거나 이미 폐기된 토큰이다. 둘을 구분해야 한다.
    const [existing] = await db.select().from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))

    if (!existing) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    // 폐기된 토큰이 다시 들어왔다 = 탈취 가능성.
    // 공격자와 정상 사용자를 구분할 수 없으므로 양쪽 다 끊는다.
    await revokeAllForUser(existing.userId)
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', '보안을 위해 로그아웃되었습니다. 다시 로그인해주세요.')
  }

  // 만료 검사는 선점 뒤에 한다. 만료된 토큰이 폐기 처리되는 건 문제가 아니다.
  if (claimed.expiresAt <= now) {
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', '다시 로그인해주세요.')
  }

  const next = await issueRefreshToken(claimed.userId)
  const [nextRow] = await db.select({ id: refreshTokens.id }).from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(next)))

  await db.update(refreshTokens)
    .set({ replacedBy: nextRow?.id ?? null })
    .where(eq(refreshTokens.id, claimed.id))

  return { userId: claimed.userId, token: next }
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  const now = dbNow()
  await db.update(refreshTokens)
    // 로그아웃은 토큰 주인의 행위이므로 그 행의 user_id를 그대로 행위자로 남긴다.
    .set({
      revokedAt: now, revokedBy: sql`${refreshTokens.userId}`,
      updatedAt: now, updatedBy: sql`${refreshTokens.userId}`,
    })
    .where(and(
      eq(refreshTokens.tokenHash, hashToken(raw)),
      isNull(refreshTokens.revokedAt),
    ))
}
