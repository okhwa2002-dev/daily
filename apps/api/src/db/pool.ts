import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

// TIMESTAMP(1114)와 DATE(1082)를 Date로 변환하지 않고 원문 문자열로 받는다.
// 변환을 허용하면 노드 프로세스의 로컬 타임존이 끼어들어 KST 벽시계 값이 틀어진다.
pg.types.setTypeParser(1114, (v: string) => v)
pg.types.setTypeParser(1082, (v: string) => v)

const connectionString =
  env.NODE_ENV === 'test'
    ? (process.env.DATABASE_URL_TEST ?? env.DATABASE_URL)
    : env.DATABASE_URL

export const pool = new pg.Pool({ connectionString, max: 10 })
export const db = drizzle(pool, { schema })
