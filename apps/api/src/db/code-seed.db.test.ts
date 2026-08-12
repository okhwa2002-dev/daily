import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { codeGroups, codes } from './schema.ts'

afterAll(async () => { await pool.end() })

describe('공통코드 시드', () => {
  it('BOOK_GENRE 그룹과 코드가 들어 있다', async () => {
    const [group] = await db.select().from(codeGroups)
      .where(eq(codeGroups.groupCode, 'BOOK_GENRE'))
    expect(group?.name).toBe('독서 장르')

    const rows = await db.select().from(codes)
      .where(eq(codes.groupCode, 'BOOK_GENRE'))
      .orderBy(codes.sortOrder)
    expect(rows.map((r) => r.code)).toEqual([
      'NOVEL', 'ESSAY', 'HUMANITIES', 'SCIENCE', 'TECH', 'ECONOMY', 'ETC',
    ])
    expect(rows[0]?.name).toBe('소설')
  })
})
