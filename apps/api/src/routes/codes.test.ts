import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { CodesResponse } from '@daily/shared'
import { buildApp } from '../app.ts'
import { db, pool } from '../db/pool.ts'
import { codeGroups, codes, users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { testLoginId } from '../db/testing.ts'
import { issueAccessToken } from '../auth/tokens.ts'

let app: FastifyInstance

/**
 * `resetDb()`를 부르지 않는다. 공통코드는 마이그레이션 시드가 넣은 운영
 * 데이터라, TRUNCATE로 비우면 이 테스트가 검증할 대상 자체가 사라진다.
 * 대신 이 파일이 만든 행만 개별적으로 지운다.
 */
const TEST_GROUP = 'TEST_ONLY_GROUP'

async function makeUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    loginId: testLoginId(email), email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

async function tokenFor(userId: number) {
  return `Bearer ${await issueAccessToken(userId)}`
}

async function get(auth?: string) {
  const res = await app.inject({
    method: 'GET', url: '/api/codes',
    headers: auth ? { authorization: auth } : {},
  })
  return { res, body: res.json() as CodesResponse }
}

beforeEach(async () => {
  await db.delete(codes).where(eq(codes.groupCode, TEST_GROUP))
  await db.delete(codeGroups).where(eq(codeGroups.groupCode, TEST_GROUP))
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await db.delete(codes).where(eq(codes.groupCode, TEST_GROUP))
  await db.delete(codeGroups).where(eq(codeGroups.groupCode, TEST_GROUP))
  await pool.end()
})

describe('GET /api/codes', () => {
  it('인증 없이는 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/codes' })
    expect(res.statusCode).toBe(401)
  })

  it('시드된 장르 그룹을 sort_order 순으로 내려보낸다', async () => {
    const auth = await tokenFor(await makeUser('acodes@example.com'))
    const { res, body } = await get(auth)

    expect(res.statusCode).toBe(200)
    const genre = body.groups.find((g) => g.groupCode === 'BOOK_GENRE')
    expect(genre?.name).toBe('독서 장르')
    expect(genre?.codes.map((c) => c.code)).toEqual([
      'NOVEL', 'ESSAY', 'HUMANITIES', 'SCIENCE', 'TECH', 'ECONOMY', 'ETC',
    ])
    expect(genre?.codes[0]).toEqual({ code: 'NOVEL', name: '소설', sortOrder: 1 })
  })

  it('삭제된 코드는 내려보내지 않는다', async () => {
    const now = dbNow()
    await db.insert(codeGroups).values({
      groupCode: TEST_GROUP, name: '테스트 그룹',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })
    await db.insert(codes).values([
      {
        groupCode: TEST_GROUP, code: 'ALIVE', name: '살아있음', sortOrder: 1,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      },
      {
        groupCode: TEST_GROUP, code: 'GONE', name: '지워짐', sortOrder: 2,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
        deletedAt: now, deletedBy: 0,
      },
    ])

    const auth = await tokenFor(await makeUser('bcodes@example.com'))
    const { body } = await get(auth)

    const group = body.groups.find((g) => g.groupCode === TEST_GROUP)
    expect(group?.codes.map((c) => c.code)).toEqual(['ALIVE'])
  })

  it('삭제된 그룹은 통째로 빠진다', async () => {
    const now = dbNow()
    await db.insert(codeGroups).values({
      groupCode: TEST_GROUP, name: '지워진 그룹',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      deletedAt: now, deletedBy: 0,
    })
    // 그룹만 지우고 그 아래 살아있는(deletedAt 없는) 코드를 남겨둔다.
    // 코드 행이 하나도 없으면 "그룹 헤더가 안 보인다"만 증명될 뿐, 그
    // 코드가 어딘가로 새어나가지 않는다는 것까지는 증명하지 못한다.
    await db.insert(codes).values({
      groupCode: TEST_GROUP, code: 'ORPHAN', name: '고아 코드', sortOrder: 1,
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })

    const auth = await tokenFor(await makeUser('ccodes@example.com'))
    const { body } = await get(auth)

    expect(body.groups.find((g) => g.groupCode === TEST_GROUP)).toBeUndefined()
    // 핵심은 이 단언이다 — 그룹이 안 보이는 것과 별개로, 그 아래 있던
    // 코드가 다른 그룹에 잘못 붙어 새어나가지 않는지 확인한다.
    const leaked = body.groups.some((g) => g.codes.some((c) => c.code === 'ORPHAN'))
    expect(leaked).toBe(false)
  })

  it('그룹 안의 코드는 sort_order 오름차순으로 온다', async () => {
    const now = dbNow()
    await db.insert(codeGroups).values({
      groupCode: TEST_GROUP, name: '정렬 테스트 그룹',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })
    // 삽입 순서와 sort_order를 일부러 어긋나게 한다. BOOK_GENRE 시드는
    // 삽입 순서와 sort_order가 우연히 같아서 ORDER BY가 빠져도 테이블이
    // 작으면 Postgres가 삽입 순서로 돌려줄 수 있다 — 그래서는 정렬 로직
    // 자체를 증명하지 못한다.
    await db.insert(codes).values([
      {
        groupCode: TEST_GROUP, code: 'THIRD', name: '셋째', sortOrder: 3,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      },
      {
        groupCode: TEST_GROUP, code: 'FIRST', name: '첫째', sortOrder: 1,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      },
      {
        groupCode: TEST_GROUP, code: 'SECOND', name: '둘째', sortOrder: 2,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      },
    ])

    const auth = await tokenFor(await makeUser('dcodes@example.com'))
    const { body } = await get(auth)

    const group = body.groups.find((g) => g.groupCode === TEST_GROUP)
    expect(group?.codes.map((c) => c.code)).toEqual(['FIRST', 'SECOND', 'THIRD'])
  })
})
