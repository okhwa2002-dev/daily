import { applyColumnComments } from './column-comments.ts'
import { db, pool } from './pool.ts'
import { ALL_COLUMN_COMMENTS } from './schema.ts'

/**
 * 컬럼 코멘트를 DB에 반영한다 (`pnpm --filter api db:comments`).
 *
 * drizzle이 코멘트를 다루지 못해 마이그레이션과 분리되어 있다. 배포는
 * `db:migrate` 다음에 이 스크립트를 돌린다. 멱등이라 몇 번 실행해도 안전하다.
 */
const count = await applyColumnComments(db, ALL_COLUMN_COMMENTS)
console.log(`컬럼 코멘트 ${count}건을 반영했습니다.`)
await pool.end()
