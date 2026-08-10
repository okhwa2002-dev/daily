import { desc, eq } from 'drizzle-orm'
import { db } from '../db/pool.ts'
import { loginAttempts } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const LOOKBACK = 20

export async function recordAttempt(
  loginId: string,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({
    loginId,
    ip,
    succeeded: succeeded ? 'Y' : 'N',
    attemptedAt: dbNow(),
  })
}

/**
 * 마지막 성공 이후 연속 실패 횟수에 따라 지연 시간을 계산한다.
 *
 * `loginId`는 이미 소문자로 정규화된 값이어야 한다. 정규화 전 값을 넘기면
 * 'Kim'과 'kim'이 서로 다른 키가 되어, 대소문자만 바꿔가며 지연을 회피할 수 있다.
 */
export async function loginDelayMs(loginId: string): Promise<number> {
  const rows = await db.select({ succeeded: loginAttempts.succeeded })
    .from(loginAttempts)
    .where(eq(loginAttempts.loginId, loginId))
    .orderBy(desc(loginAttempts.attemptedAt), desc(loginAttempts.id))
    .limit(LOOKBACK)

  let consecutiveFailures = 0
  for (const row of rows) {
    if (row.succeeded === 'Y') break
    consecutiveFailures += 1
  }

  if (consecutiveFailures === 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS)
}
