import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { SCHEMA_VERSION, type PullResponse, type PushResponse } from '@daily/shared'
import { buildApp } from '../app.ts'
import { db, pool } from '../db/pool.ts'
import { bookNotes, books, expenseCategories, expenses, users } from '../db/schema.ts'
import { dbNow, padMillis } from '../db/time.ts'
import { resetDb, testLoginId } from '../db/testing.ts'
import { issueAccessToken } from '../auth/tokens.ts'

let app: FastifyInstance

const TODAY = '2026-08-10'
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** 정착 지연(1초)을 건너뛰기 위해 충분히 과거인 커서 */
const FROM_START = { since: '1970-01-01 00:00:00.000', sinceId: 0 }

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

interface ChangeInput {
  table: 'expenses' | 'expense_categories' | 'books' | 'book_notes'
  clientUuid: string
  op?: 'UPSERT' | 'DELETE'
  updatedAt: string
  payload?: unknown
}

async function push(auth: string, changes: ChangeInput[], schemaVersion = SCHEMA_VERSION) {
  const res = await app.inject({
    method: 'POST', url: '/api/sync/push', headers: { authorization: auth },
    payload: {
      schemaVersion,
      changes: changes.map((c) => ({ op: 'UPSERT' as const, ...c })),
    },
  })
  return { res, body: res.json() as PushResponse }
}

async function pull(auth: string, query: Record<string, string | number> = FROM_START) {
  // schemaVersion을 기본으로 섞어 넣는다. 이 헬퍼를 거치는 모든 호출(커서를
  // 직접 만든 경우 포함)이 자동으로 버전을 보내게 하기 위해서다 — 호출부마다
  // 빠뜨리지 않는지 각각 챙겨야 한다면 그중 하나는 결국 빠진다. query가
  // schemaVersion을 명시하면 그 값으로 덮어써 구버전 테스트도 그대로 쓸 수 있다.
  const merged = { schemaVersion: SCHEMA_VERSION, ...query }
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])),
  ).toString()
  const res = await app.inject({
    method: 'GET', url: `/api/sync/pull?${qs}`, headers: { authorization: auth },
  })
  return { res, body: res.json() as PullResponse }
}

/** 정착 지연을 넘기기 위해 synced_at을 과거로 밀어둔다. */
async function settle() {
  const past = '2026-01-01 00:00:00.000'
  await db.update(expenses).set({ syncedAt: past })
  await db.update(expenseCategories).set({ syncedAt: past })
  await db.update(books).set({ syncedAt: past })
  await db.update(bookNotes).set({ syncedAt: past })
}

const expensePayload = (amount: string, extra: Record<string, unknown> = {}) => ({
  occurredOn: TODAY, kind: 'EXPENSE', amount, ...extra,
})

beforeEach(async () => {
  await resetDb()
  app = await buildApp()
  await app.ready()
})
afterAll(async () => { await pool.end() })

describe('POST /api/sync/push', () => {
  it('인증 없이는 401을 반환한다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      payload: { schemaVersion: SCHEMA_VERSION, changes: [] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('오프라인에서 만든 레코드를 저장한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload('12000.00', { memo: '점심' }),
    }])

    expect(body.results[0]?.status).toBe('APPLIED')
    expect(body.results[0]?.id).toBeGreaterThan(0)

    const [row] = await db.select().from(expenses)
    expect(row?.amount).toBe('12000.00')
    // 클라이언트가 보낸 +09:00 시각이 KST 벽시계로 정규화되어 저장돼야 한다.
    // DB 원문은 뒤따르는 0이 잘려 나오므로 자릿수를 채워 비교한다.
    expect(padMillis(row!.updatedAt)).toBe('2026-08-10 12:00:00.000')
  })

  it('응답의 시각은 밀리초 3자리로 고정된다', async () => {
    // 자릿수가 흔들리면 클라이언트의 문자열 비교에서 서버 값이 항상
    // "더 오래됨"으로 판정되어 같은 레코드를 끝없이 재전송한다.
    const auth = await tokenFor(await makeUser('a@example.com'))
    const change: ChangeInput = {
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }
    await push(auth, [change])
    const { body } = await push(auth, [change])

    const row = body.results[0]?.serverRow
    expect(row?.updatedAt).toMatch(/\.\d{3}$/)
    expect(row?.syncedAt).toMatch(/\.\d{3}$/)
  })

  it('같은 변경을 두 번 보내도 행이 하나다 — 멱등', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const change: ChangeInput = {
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload('12000.00'),
    }

    const first = await push(auth, [change])
    expect(first.body.results[0]?.status).toBe('APPLIED')

    const second = await push(auth, [change])
    // 같은 updatedAt이라 LWW에서 이기지 못한다. 데이터는 동일하므로 안전하다.
    expect(second.body.results[0]?.status).toBe('STALE')
    expect(second.body.results[0]?.serverRow?.payload.amount).toBe('12000.00')

    expect(await db.select().from(expenses)).toHaveLength(1)
  })

  it('나중 updatedAt이 이긴다 — last-write-wins', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T13:00:00+09:00', payload: expensePayload('2000'),
    }])

    expect(body.results[0]?.status).toBe('APPLIED')
    const [row] = await db.select().from(expenses)
    expect(row?.amount).toBe('2000.00')
  })

  it('오래된 변경은 최신 값을 덮지 못한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T13:00:00+09:00', payload: expensePayload('2000'),
    }])
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])

    expect(body.results[0]?.status).toBe('STALE')
    expect(body.results[0]?.serverRow?.payload.amount).toBe('2000.00')
    const [row] = await db.select().from(expenses)
    expect(row?.amount).toBe('2000.00')
  })

  it('삭제는 툼스톤을 남긴다 — 물리 삭제하지 않는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1), op: 'DELETE',
      updatedAt: '2026-08-10T13:00:00+09:00',
    }])

    expect(body.results[0]?.status).toBe('APPLIED')
    const [row] = await db.select().from(expenses)
    expect(padMillis(row!.deletedAt!)).toBe('2026-08-10 13:00:00.000')
  })

  it('오래된 삭제가 그 뒤의 수정을 덮지 못한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T13:00:00+09:00', payload: expensePayload('2000'),
    }])
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1), op: 'DELETE',
      updatedAt: '2026-08-10T12:00:00+09:00',
    }])

    expect(body.results[0]?.status).toBe('STALE')
    const [row] = await db.select().from(expenses)
    expect(row?.deletedAt).toBeNull()
  })

  it('서버가 모르는 레코드의 삭제는 큐에서 내보낸다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(99), op: 'DELETE',
      updatedAt: '2026-08-10T12:00:00+09:00',
    }])
    expect(body.results[0]?.status).toBe('APPLIED')
  })

  it('부모가 아직 없으면 CONFLICT — 큐에 남겨 재시도하게 한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(2),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
    }])

    expect(body.results[0]?.status).toBe('CONFLICT')
    expect(await db.select().from(expenses)).toHaveLength(0)
  })

  it('부모를 먼저 보내면 같은 배치에서 자식까지 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      {
        table: 'expense_categories', clientUuid: UUID(1),
        updatedAt: '2026-08-10T12:00:00+09:00', payload: { name: '식비' },
      },
      {
        table: 'expenses', clientUuid: UUID(2),
        updatedAt: '2026-08-10T12:00:01+09:00',
        payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
      },
    ])

    expect(body.results.map((r) => r.status)).toEqual(['APPLIED', 'APPLIED'])
    const [row] = await db.select().from(expenses)
    const [cat] = await db.select().from(expenseCategories)
    expect(row?.categoryId).toBe(cat?.id)
  })

  it('CONFLICT 이후 부모가 도착하면 재시도가 성공한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const child: ChangeInput = {
      table: 'expenses', clientUuid: UUID(2),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
    }
    expect((await push(auth, [child])).body.results[0]?.status).toBe('CONFLICT')

    await push(auth, [{
      table: 'expense_categories', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: { name: '식비' },
    }])
    expect((await push(auth, [child])).body.results[0]?.status).toBe('APPLIED')
  })

  it('삭제된 부모도 찾는다 — 그러지 않으면 큐가 영영 막힌다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expense_categories', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: { name: '식비' },
    }])
    await push(auth, [{
      table: 'expense_categories', clientUuid: UUID(1), op: 'DELETE',
      updatedAt: '2026-08-10T13:00:00+09:00',
    }])

    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(2),
      updatedAt: '2026-08-10T14:00:00+09:00',
      payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
    }])
    expect(body.results[0]?.status).toBe('APPLIED')
  })

  it('한 건이 실패해도 나머지는 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      {
        table: 'expenses', clientUuid: UUID(1),
        updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
      },
      {
        table: 'expenses', clientUuid: UUID(2),
        updatedAt: '2026-08-10T12:00:00+09:00',
        payload: expensePayload('1000', { kind: 'SPEND' }),
      },
      {
        table: 'expenses', clientUuid: UUID(3),
        updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('3000'),
      },
    ])

    expect(body.results.map((r) => r.status)).toEqual(['APPLIED', 'REJECTED', 'APPLIED'])
    expect(await db.select().from(expenses)).toHaveLength(2)
  })

  it('공통 컬럼을 페이로드로 밀어넣으려 하면 거부한다', async () => {
    const victim = await makeUser('victim@example.com')
    const auth = await tokenFor(await makeUser('attacker@example.com'))
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: { ...expensePayload('1000'), userId: victim, syncedAt: '2099-01-01 00:00:00.000' },
    }])

    // strict 스키마가 모르는 키를 막는다.
    expect(body.results[0]?.status).toBe('REJECTED')
    expect(await db.select().from(expenses)).toHaveLength(0)
  })

  it('해석할 수 없는 updatedAt은 거부한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: 'not-a-date', payload: expensePayload('1000'),
    }])
    expect(body.results[0]?.status).toBe('REJECTED')
  })

  it('기기 시계가 크게 앞선 레코드는 거부한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { body } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: future, payload: expensePayload('1000'),
    }])
    expect(body.results[0]?.status).toBe('REJECTED')
  })

  it('구버전 클라이언트는 426으로 막는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { res } = await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }], SCHEMA_VERSION - 1)

    expect(res.statusCode).toBe(426)
    expect(res.json().error.code).toBe('UPGRADE_REQUIRED')
  })

  it('알 수 없는 테이블은 400으로 막는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const res = await app.inject({
      method: 'POST', url: '/api/sync/push', headers: { authorization: auth },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        changes: [{
          table: 'users', clientUuid: UUID(1), op: 'UPSERT',
          updatedAt: '2026-08-10T12:00:00+09:00', payload: {},
        }],
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/sync/pull', () => {
  it('인증 없이는 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/pull' })
    expect(res.statusCode).toBe(401)
  })

  it('구버전 스키마 버전으로 pull하면 426이다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { res } = await pull(auth, { ...FROM_START, schemaVersion: SCHEMA_VERSION - 1 })

    expect(res.statusCode).toBe(426)
    expect(res.json().error.code).toBe('UPGRADE_REQUIRED')
  })

  it('schemaVersion 없이 pull하면 426이다 — v1 클라이언트가 실제로 보내는 요청 모양', async () => {
    // v1 클라이언트는 pull에 schemaVersion을 아예 보내지 않는다. 옵셔널로 두면
    // 이 요청이 그냥 통과해 버리고, 그 기기는 모르는 테이블(books)의 행을
    // 받아 동기화 루프가 죽는다. 필수 파라미터라 파싱 단계에서부터 걸려야 한다.
    const auth = await tokenFor(await makeUser('a@example.com'))
    const res = await app.inject({
      method: 'GET', url: '/api/sync/pull', headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(426)
    expect(res.json().error.code).toBe('UPGRADE_REQUIRED')
  })

  it('자기 기록만 내려받는다', async () => {
    const authA = await tokenFor(await makeUser('a@example.com'))
    const authB = await tokenFor(await makeUser('b@example.com'))
    await push(authA, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await push(authB, [{
      table: 'expenses', clientUuid: UUID(2),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('2000'),
    }])
    await settle()

    const { body } = await pull(authA)
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0]?.clientUuid).toBe(UUID(1))
  })

  it('툼스톤도 내려보낸다 — 삭제가 전파되어야 한다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1), op: 'DELETE',
      updatedAt: '2026-08-10T13:00:00+09:00',
    }])
    await settle()

    const { body } = await pull(auth)
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0]?.deletedAt).not.toBeNull()
  })

  it('여러 테이블의 변경을 한 스트림으로 합친다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      {
        table: 'expense_categories', clientUuid: UUID(1),
        updatedAt: '2026-08-10T12:00:00+09:00', payload: { name: '식비' },
      },
      {
        table: 'expenses', clientUuid: UUID(2),
        updatedAt: '2026-08-10T12:00:01+09:00',
        payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
      },
    ])
    await settle()

    const { body } = await pull(auth)
    expect(body.changes.map((c) => c.table).sort())
      .toEqual(['expense_categories', 'expenses'])
  })

  it('커서 이후만 내려보낸다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await settle()

    const first = await pull(auth)
    expect(first.body.changes).toHaveLength(1)
    const cursor = first.body.nextCursor!

    const second = await pull(auth, { since: cursor.syncedAt, sinceId: cursor.id })
    expect(second.body.changes).toHaveLength(0)
    expect(second.body.nextCursor).toBeNull()
  })

  it('같은 synced_at이 여러 개여도 페이지 경계에서 누락되지 않는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, Array.from({ length: 5 }, (_, i) => ({
      table: 'expenses' as const, clientUuid: UUID(i + 1),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload(String((i + 1) * 1000)),
    })))
    // 5건 전부 같은 synced_at으로 만든다 — 타임스탬프만으로는 구분되지 않는 상황
    await settle()

    const seen = new Set<string>()
    let cursor = FROM_START
    for (let page = 0; page < 10; page += 1) {
      const { body } = await pull(auth, { ...cursor, limit: 2 })
      body.changes.forEach((c) => seen.add(c.clientUuid))
      if (!body.nextCursor) break
      cursor = { since: body.nextCursor.syncedAt, sinceId: body.nextCursor.id }
      if (!body.hasMore) break
    }

    expect(seen.size).toBe(5)
  })

  it('아직 굳지 않은 변경은 내려보내지 않는다 — 정착 지연', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])

    // settle()을 부르지 않았으므로 방금 쓴 행은 아직 정착 구간 안이다.
    const { body } = await pull(auth)
    expect(body.changes).toHaveLength(0)
  })

  it('since 없이 부르면 처음부터 내려받는다 — 초기 동기화', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await settle()

    const res = await app.inject({
      method: 'GET', url: `/api/sync/pull?schemaVersion=${SCHEMA_VERSION}`,
      headers: { authorization: auth },
    })
    expect((res.json() as PullResponse).changes).toHaveLength(1)
  })

  it('페이로드에 다른 사용자의 컬럼이 섞여 나오지 않는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await settle()

    const { body } = await pull(auth)
    // user_id·created_by 같은 내부 컬럼은 페이로드에 포함되지 않는다.
    expect(Object.keys(body.changes[0]!.payload).sort())
      .toEqual(['amount', 'categoryClientUuid', 'kind', 'memo', 'occurredOn'])
  })
})

describe('교차 계정 격리', () => {
  it('남의 레코드를 같은 client_uuid로 덮어쓸 수 없다', async () => {
    const victimId = await makeUser('victim@example.com')
    const authV = await tokenFor(victimId)
    const authA = await tokenFor(await makeUser('attacker@example.com'))

    await push(authV, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await push(authA, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T13:00:00+09:00', payload: expensePayload('9999'),
    }])

    // 두 행이 각자 생긴다. 피해자의 값은 그대로다.
    const victimRows = await db.select().from(expenses)
      .where(eq(expenses.userId, victimId))
    expect(victimRows).toHaveLength(1)
    expect(victimRows[0]?.amount).toBe('1000.00')
  })

  it('남의 레코드를 삭제할 수 없다', async () => {
    const victimId = await makeUser('victim@example.com')
    const authV = await tokenFor(victimId)
    const authA = await tokenFor(await makeUser('attacker@example.com'))

    await push(authV, [{
      table: 'expenses', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: expensePayload('1000'),
    }])
    await push(authA, [{
      table: 'expenses', clientUuid: UUID(1), op: 'DELETE',
      updatedAt: '2026-08-10T13:00:00+09:00',
    }])

    const [row] = await db.select().from(expenses).where(eq(expenses.userId, victimId))
    expect(row?.deletedAt).toBeNull()
  })

  it('남의 카테고리를 부모로 삼을 수 없다', async () => {
    const authV = await tokenFor(await makeUser('victim@example.com'))
    const authA = await tokenFor(await makeUser('attacker@example.com'))

    await push(authV, [{
      table: 'expense_categories', clientUuid: UUID(1),
      updatedAt: '2026-08-10T12:00:00+09:00', payload: { name: '식비' },
    }])
    const { body } = await push(authA, [{
      table: 'expenses', clientUuid: UUID(2),
      updatedAt: '2026-08-10T12:00:00+09:00',
      payload: expensePayload('1000', { categoryClientUuid: UUID(1) }),
    }])

    // 남의 카테고리는 보이지 않으므로 "아직 없음"으로 처리된다.
    expect(body.results[0]?.status).toBe('CONFLICT')
  })
})

describe('독서 — 부모-자식 동기화', () => {
  const AT = '2026-08-11T12:00:00+09:00'
  const bookPayload = (over: Record<string, unknown> = {}) => ({
    title: '사피엔스', status: 'READING', ...over,
  })
  const notePayload = (bookUuid: string, over: Record<string, unknown> = {}) => ({
    occurredOn: TODAY, bookClientUuid: bookUuid, content: '3부가 인상 깊다', ...over,
  })

  it('같은 배치에서 책이 먼저 오면 감상평의 book_id가 채워진다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    expect(body.results.map((r) => r.status)).toEqual(['APPLIED', 'APPLIED'])

    const [book] = await db.select().from(books)
    const [note] = await db.select().from(bookNotes)
    expect(note?.bookId).toBe(book?.id)
    expect(note?.bookClientUuid).toBe(UUID(1))
  })

  it('부모 책이 아직 없으면 REJECTED가 아니라 CONFLICT다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // REJECTED로 만들면 클라이언트가 큐에서 빼버려 감상평이 영구 소실된다.
    expect(body.results[0]?.status).toBe('CONFLICT')
    expect(await db.select().from(bookNotes)).toHaveLength(0)
  })

  it('부모를 보낸 뒤 재시도하면 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])
    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    expect(body.results[0]?.status).toBe('APPLIED')
    expect(await db.select().from(bookNotes)).toHaveLength(1)
  })

  it('남의 책을 부모로 지정하면 CONFLICT다', async () => {
    const mine = await tokenFor(await makeUser('a@example.com'))
    const theirs = await tokenFor(await makeUser('bbbb@example.com'))
    const theirsPush = await push(theirs, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])
    // 이 push가 조용히 실패하면 아래 CONFLICT는 소유권 격리가 아니라 그냥
    // "부모 없음"을 검증하는 것으로 퇴화한다.
    expect(theirsPush.body.results[0]?.status).toBe('APPLIED')

    const { body } = await push(mine, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // 소유권 격리. 남의 책 id가 내 감상평에 박히면 안 된다.
    expect(body.results[0]?.status).toBe('CONFLICT')
    expect(await db.select().from(bookNotes)).toHaveLength(0)
  })

  it('삭제된 책도 부모로 찾는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), op: 'DELETE', updatedAt: '2026-08-11T13:00:00+09:00' },
    ])
    // DELETE가 no-op이었다면 부모가 살아 있으니 아래 APPLIED는 툼스톤을 찾은
    // 결과가 아니라 그냥 부모가 여전히 산 값이라 통과한 것이 된다. 이 assert가
    // 없으면 이 테스트가 실제로 뭘 증명하는지 알 수 없다.
    expect((await db.select().from(books))[0]?.deletedAt).not.toBeNull()

    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // 툼스톤을 제외하면 이 감상평은 영원히 CONFLICT가 되어 큐가 막힌다.
    expect(body.results[0]?.status).toBe('APPLIED')
  })

  it('기간이 뒤집힌 책은 REJECTED다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ startedOn: '2026-08-10', finishedOn: '2026-08-09' }),
    }])

    // zod에서 걸려야 한다. DB CHECK까지 가면 500이고, 500은 재시도 대상이다.
    expect(body.results[0]?.status).toBe('REJECTED')
  })

  it('pull로 책과 감상평이 내려온다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])
    await settle()

    const { body } = await pull(auth)
    const tables = body.changes.map((c) => c.table)
    expect(tables).toContain('books')
    expect(tables).toContain('book_notes')

    const note = body.changes.find((c) => c.table === 'book_notes')
    expect(note?.occurredOn).toBe(TODAY)
    expect(note?.payload.bookClientUuid).toBe(UUID(1))
    // 서버 내부 id는 페이로드에 실리지 않는다.
    expect(note?.payload.bookId).toBeUndefined()

    const book = body.changes.find((c) => c.table === 'books')
    expect(book?.occurredOn).toBeNull()
    expect(book?.payload.title).toBe('사피엔스')
  })
})
