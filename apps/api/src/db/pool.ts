import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

// TIMESTAMP(1114)와 DATE(1082)를 Date로 변환하지 않고 원문 문자열로 받는다.
// 변환을 허용하면 노드 프로세스의 로컬 타임존이 끼어들어 KST 벽시계 값이 틀어진다.
pg.types.setTypeParser(1114, (v: string) => v)
pg.types.setTypeParser(1082, (v: string) => v)

// 테스트에서는 반드시 테스트 DB로만 붙는다. 폴백을 두지 않는 이유:
// Vitest가 NODE_ENV=test를 자동 설정하므로, DATABASE_URL_TEST가 비어 있을 때
// 개발 DB로 흘러가면 resetDb()의 TRUNCATE가 개발 데이터를 날린다.
// env 스키마가 test 환경에서 이 값을 필수로 강제하므로 여기서는 단정해도 된다.
export const connectionString =
  env.NODE_ENV === 'test' ? env.DATABASE_URL_TEST! : env.DATABASE_URL

export const pool = new pg.Pool({ connectionString, max: 10 })
export const db = drizzle(pool, { schema })
