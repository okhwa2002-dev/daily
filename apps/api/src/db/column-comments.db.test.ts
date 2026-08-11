import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { applyColumnComments } from './column-comments.ts'
import { db, pool } from './pool.ts'
import { ALL_COLUMN_COMMENTS } from './schema.ts'

afterAll(async () => { await pool.end() })

async function readComment(table: string, column: string): Promise<string | null> {
  const { rows } = await db.execute<{ comment: string | null }>(sql`
    SELECT col_description(c.oid, a.attnum) AS comment
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.relname = ${table} AND a.attname = ${column}
  `)
  return rows[0]?.comment ?? null
}

describe('applyColumnComments', () => {
  it('코멘트를 DB에 반영해 되읽을 수 있다', async () => {
    await applyColumnComments(db, ALL_COLUMN_COMMENTS)

    expect(await readComment('expenses', 'amount'))
      .toBe('금액. 부호는 kind가 가지므로 항상 0 이상이다')
    // 공유 컬럼도 테이블마다 붙는다.
    expect(await readComment('meals', 'synced_at'))
      .toBe('pull 커서. 서버가 직접 찍으며 클라이언트 값을 쓰지 않는다')
    // 스프레드 뒤의 재정의가 이긴다.
    expect(await readComment('journals', 'client_uuid'))
      .toContain('uuidv5')
  })

  it('다시 실행해도 결과가 같다 — 멱등', async () => {
    await applyColumnComments(db, ALL_COLUMN_COMMENTS)
    await applyColumnComments(db, ALL_COLUMN_COMMENTS)

    expect(await readComment('books', 'status'))
      .toBe('읽기 상태 — READING | DONE | WISHLIST')
  })
})
