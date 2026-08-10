import { sql } from 'drizzle-orm'
import { db } from './pool.ts'
import { env } from '../env.ts'

/** 테스트 DB의 모든 테이블을 비운다. 운영 DB에서는 절대 실행되지 않는다. */
export async function resetDb(): Promise<void> {
  if (env.NODE_ENV !== 'test') {
    throw new Error('resetDb는 테스트 환경에서만 실행할 수 있습니다.')
  }
  await db.execute(sql`
    TRUNCATE TABLE login_attempts, password_reset_tokens, refresh_tokens, users
    RESTART IDENTITY CASCADE
  `)
}
