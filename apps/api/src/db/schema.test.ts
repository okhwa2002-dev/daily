import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, getTableColumns } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { codeGroups, codes, users } from './schema.ts'
import { dbNow } from './time.ts'
import { resetDb } from './testing.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

/**
 * PostgreSQL은 timestamp를 텍스트로 낼 때 소수점 이하 초의 뒤따르는 0을
 * 잘라낸다(`.100` -> `.1`, `.000` -> 점 없음). dbNow()는 항상 3자리
 * 밀리초를 채워 넣으므로, 저장한 원문과 비교하려면 이 잘림을 되돌려야 한다.
 */
function normalizeMillis(s: string | undefined): string {
  if (!s) return ''
  const [head, frac] = s.split('.')
  return frac === undefined ? `${head}.000` : `${head}.${frac.padEnd(3, '0')}`
}

describe('users 테이블', () => {
  it('사용자를 저장하고 조회한다', async () => {
    const now = dbNow()
    const [inserted] = await db.insert(users).values({
      loginId: 'auser',
      email: 'a@example.com',
      passwordHash: 'hash',
      status: 'ACTIVE',
      createdAt: now,
      createdBy: 0,
      updatedAt: now,
      updatedBy: 0,
    }).returning()

    expect(inserted?.id).toBeGreaterThan(0)

    const found = await db.select().from(users).where(eq(users.email, 'a@example.com'))
    expect(found).toHaveLength(1)
    expect(found[0]?.status).toBe('ACTIVE')
  })

  it('시각 컬럼은 KST 벽시계 문자열로 저장된다', async () => {
    const now = dbNow()
    await db.insert(users).values({
      loginId: 'buser', email: 'b@example.com', passwordHash: 'h', status: 'ACTIVE',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })

    const [row] = await db.select().from(users).where(eq(users.email, 'b@example.com'))
    // 타임존 접미사 없이 원문 그대로 돌아와야 한다
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(row?.createdAt).not.toContain('Z')
    expect(row?.createdAt).not.toContain('+')
    // 값 자체가 왕복해야 한다 — 형태만 맞고 시각이 9시간 밀리는 회귀를 잡는다.
    // PostgreSQL은 소수점 이하 초의 뒤따르는 0을 잘라서 돌려준다
    // (예: '.100' -> '.1', '.000' -> 점 자체가 없음)이므로, 원문과 완전히
    // 같은 문자열이 아니라 밀리초 자릿수를 3자리로 되돌린 값으로 비교한다.
    expect(normalizeMillis(row?.createdAt)).toBe(now)
  })

  it('이메일은 중복될 수 없다', async () => {
    const now = dbNow()
    const values = {
      loginId: 'dupuser', email: 'dup@example.com', passwordHash: 'h', status: 'ACTIVE' as const,
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    }
    await db.insert(users).values(values)
    await expect(db.insert(users).values(values)).rejects.toThrow()
  })
})

describe('공통코드 테이블', () => {
  it('code_groups는 동기화 컬럼을 갖지 않는다', () => {
    const columns = Object.keys(getTableColumns(codeGroups))
    // 사용자 데이터가 아니다. user_id를 두면 전역 코드가 사용자별로 갈라진다.
    expect(columns).not.toContain('userId')
    expect(columns).not.toContain('clientUuid')
    expect(columns).not.toContain('syncedAt')
  })

  it('codes는 동기화 컬럼을 갖지 않는다', () => {
    const columns = Object.keys(getTableColumns(codes))
    expect(columns).not.toContain('userId')
    expect(columns).not.toContain('clientUuid')
    expect(columns).not.toContain('syncedAt')
  })

  it('code_groups는 감사 컬럼을 갖는다', () => {
    const columns = Object.keys(getTableColumns(codeGroups))
    for (const name of [
      'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy',
    ]) {
      expect(columns).toContain(name)
    }
  })

  it('codes는 그룹·코드·라벨·정렬을 갖는다', () => {
    const columns = Object.keys(getTableColumns(codes))
    for (const name of ['groupCode', 'code', 'name', 'sortOrder']) {
      expect(columns).toContain(name)
    }
  })
})
