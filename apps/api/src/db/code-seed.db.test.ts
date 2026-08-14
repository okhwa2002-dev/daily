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

  // 이 시드는 codes.ts의 BODY_PART enum을 그대로 옮긴 것이다. 값이나 순서가
  // 달라지면 마이그레이션 직후 화면이 지금과 달라진다 — 이전은 무변화여야 한다.
  it('BODY_PART 그룹과 코드가 들어 있다', async () => {
    const [group] = await db.select().from(codeGroups)
      .where(eq(codeGroups.groupCode, 'BODY_PART'))
    expect(group?.name).toBe('운동 부위')

    const rows = await db.select().from(codes)
      .where(eq(codes.groupCode, 'BODY_PART'))
      .orderBy(codes.sortOrder)
    expect(rows.map((r) => r.code)).toEqual([
      'CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'FULL_BODY',
    ])
    expect(rows.map((r) => r.name)).toEqual([
      '가슴', '등', '하체', '어깨', '팔', '코어', '전신',
    ])
  })

  it('INTENSITY 그룹과 코드가 들어 있다', async () => {
    const [group] = await db.select().from(codeGroups)
      .where(eq(codeGroups.groupCode, 'INTENSITY'))
    expect(group?.name).toBe('운동 강도')

    const rows = await db.select().from(codes)
      .where(eq(codes.groupCode, 'INTENSITY'))
      .orderBy(codes.sortOrder)
    expect(rows.map((r) => r.code)).toEqual(['LOW', 'MID', 'HIGH'])
    expect(rows.map((r) => r.name)).toEqual(['가볍게', '보통', '힘들게'])
  })
})
