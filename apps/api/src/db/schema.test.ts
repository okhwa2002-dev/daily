import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { users } from './schema.ts'
import { dbNow } from './time.ts'
import { resetDb } from './testing.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('users 테이블', () => {
  it('사용자를 저장하고 조회한다', async () => {
    const now = dbNow()
    const [inserted] = await db.insert(users).values({
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
      email: 'b@example.com', passwordHash: 'h', status: 'ACTIVE',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })

    const [row] = await db.select().from(users).where(eq(users.email, 'b@example.com'))
    // 타임존 접미사 없이 원문 그대로 돌아와야 한다
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(row?.createdAt).not.toContain('Z')
    expect(row?.createdAt).not.toContain('+')
  })

  it('이메일은 중복될 수 없다', async () => {
    const now = dbNow()
    const values = {
      email: 'dup@example.com', passwordHash: 'h', status: 'ACTIVE' as const,
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    }
    await db.insert(users).values(values)
    await expect(db.insert(users).values(values)).rejects.toThrow()
  })
})
