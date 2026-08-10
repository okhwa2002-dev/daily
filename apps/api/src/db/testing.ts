import { sql } from 'drizzle-orm'
import { db, connectionString } from './pool.ts'
import { env } from '../env.ts'

/** 테스트 DB의 모든 테이블을 비운다. 운영 DB에서는 절대 실행되지 않는다. */
export async function resetDb(): Promise<void> {
  if (env.NODE_ENV !== 'test') {
    throw new Error('resetDb는 테스트 환경에서만 실행할 수 있습니다.')
  }
  // NODE_ENV만 믿지 않는다. 실제로 붙어 있는 대상이 개발 DB면 멈춘다.
  // 이 두 겹이 있어야 환경변수 하나가 잘못돼도 개발 데이터가 날아가지 않는다.
  if (connectionString === env.DATABASE_URL) {
    throw new Error('resetDb가 개발 DB를 가리키고 있습니다. DATABASE_URL_TEST를 확인하세요.')
  }
  // 테이블 목록을 손으로 관리하면 새 테이블을 추가할 때마다 빠뜨리고,
  // 그 누락은 "테스트가 가끔 실패한다"는 형태로만 드러난다. 카탈로그에서 읽는다.
  // drizzle 마이그레이션 기록은 별도 스키마(drizzle)에 있어 여기 걸리지 않는다.
  const { rows } = await db.execute<{ tables: string | null }>(sql`
    SELECT string_agg(quote_ident(tablename), ', ') AS tables
      FROM pg_tables
     WHERE schemaname = 'public'
  `)
  const tables = rows[0]?.tables
  if (!tables) return

  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`))
}
