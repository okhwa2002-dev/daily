import { desc, eq } from 'drizzle-orm'
import { db } from '../db/pool.ts'
import { loginAttempts } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const LOOKBACK = 20

export async function recordAttempt(
  email: string,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({
    email: email.toLowerCase(),
    ip,
    succeeded: succeeded ? 'Y' : 'N',
    attemptedAt: dbNow(),
  })
}

/** 마지막 성공 이후 연속 실패 횟수에 따라 지연 시간을 계산한다. */
export async function loginDelayMs(email: string): Promise<number> {
  const rows = await db.select({ succeeded: loginAttempts.succeeded })
    .from(loginAttempts)
    .where(eq(loginAttempts.email, email.toLowerCase()))
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
