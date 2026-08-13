import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, type PullResponse, type PushResponse } from '@daily/shared'
import { db, META_KEY } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { enqueue, pendingCount, takeBatch } from './outbox.ts'
import { claimLocalData, clearLocalData, resetSyncState, syncNow } from './engine.ts'

const USER = 1
const UUID_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const UUID_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const fetchMock = vi.fn()

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken('token')
  resetSyncState()
  // 스토어를 이름으로 나열하면 새 테이블을 추가할 때 빠뜨리고, 그 누락은
  // "앞 테스트의 행이 다음 테스트로 샌다"는 형태로만 드러난다.
  await Promise.all(db.tables.map((table) => table.clear()))
})
afterEach(() => { vi.unstubAllGlobals() })

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

const pushOk = (results: PushResponse['results']): Response =>
  json({ results, serverTime: '2026-08-10 12:00:00.000' } satisfies PushResponse)

const pullEmpty = (): Response =>
  json({ changes: [], nextCursor: null, hasMore: false } satisfies PullResponse)

const expenseRow = (over: Record<string, unknown> = {}) => ({
  table: 'expenses' as const,
  id: 10,
  clientUuid: UUID_A,
  occurredOn: '2026-08-10',
  updatedAt: '2026-08-10 12:00:00.000',
  syncedAt: '2026-08-10 12:00:00.500',
  deletedAt: null,
  payload: {
    occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '1000',
    categoryClientUuid: null, memo: null,
  },
  ...over,
})

async function queueExpense(clientUuid = UUID_A, updatedAt = '2026-08-10 12:00:00.000') {
  await db.expenses.put({
    clientUuid, userId: USER, serverId: null,
    occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '1000',
    categoryClientUuid: null, memo: null, updatedAt, deletedAt: null,
  })
  await enqueue({
    table: 'expenses', clientUuid, op: 'UPSERT',
    payload: {
      occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '1000',
      categoryClientUuid: null, memo: null,
    },
    updatedAt, everSynced: false,
  })
}

describe('push', () => {
  it('APPLIED면 큐에서 빠지고 serverId가 기록된다', async () => {
    await queueExpense()
    fetchMock
      .mockResolvedValueOnce(pushOk([
        { clientUuid: UUID_A, table: 'expenses', status: 'APPLIED', id: 42 },
      ]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    expect(outcome.error).toBeNull()
    expect(outcome.pushed).toBe(1)
    expect(await pendingCount()).toBe(0)
    expect((await db.expenses.get(UUID_A))?.serverId).toBe(42)
  })

  it('STALE이면 로컬을 서버 값으로 맞추고 큐에서 뺀다', async () => {
    await queueExpense(UUID_A, '2026-08-10 11:00:00.000')
    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'STALE', id: 42,
        serverRow: expenseRow({
          id: 42,
          updatedAt: '2026-08-10 13:00:00.000',
          payload: {
            occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '9999',
            categoryClientUuid: null, memo: '서버 값',
          },
        }),
      }]))
      .mockResolvedValueOnce(pullEmpty())

    await syncNow(USER)

    const local = await db.expenses.get(UUID_A)
    expect(local?.amount).toBe('9999')
    expect(local?.memo).toBe('서버 값')
    expect(await pendingCount()).toBe(0)
  })

  it('CONFLICT면 큐에 남는다 — 영구 실패가 아니다', async () => {
    await queueExpense()
    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'CONFLICT',
        reason: '부모 레코드가 아직 서버에 없습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    expect(outcome.retrying).toBe(1)
    expect(await pendingCount()).toBe(1)
    const [row] = await takeBatch(1)
    expect(row?.tryCount).toBe(1)
  })

  it('CONFLICT가 상한을 넘으면 격리하고 큐에서 뺀다', async () => {
    await queueExpense()
    // 이 항목은 이미 9번 재시도했다. 이번이 10번째다.
    const [queued] = await takeBatch(1)
    await db.outbox.update(queued!.seq, { tryCount: 9 })

    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'CONFLICT',
        reason: '부모 레코드가 아직 서버에 없습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    // 무한 재시도를 끊는다. 큐에 남으면 pendingCount가 영영 0이 되지 않는다.
    expect(await pendingCount()).toBe(0)
    expect(outcome.retrying).toBe(0)
    expect(outcome.rejected).toBe(1)

    // 큐에서 빼되 버리지는 않는다.
    const failures = await db.syncFailures.toArray()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.clientUuid).toBe(UUID_A)
    expect(failures[0]?.reason).toBe('부모 레코드가 아직 서버에 없습니다.')
  })

  it('상한 이전의 CONFLICT는 그대로 큐에 남는다', async () => {
    await queueExpense()
    const [queued] = await takeBatch(1)
    await db.outbox.update(queued!.seq, { tryCount: 8 })

    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'CONFLICT',
        reason: '부모 레코드가 아직 서버에 없습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    expect(outcome.retrying).toBe(1)
    expect(await pendingCount()).toBe(1)
    expect(await db.syncFailures.count()).toBe(0)
    const [row] = await takeBatch(1)
    expect(row?.tryCount).toBe(9)
  })

  it('REJECTED면 큐에서 빼되 버리지 않고 보관한다', async () => {
    await queueExpense()
    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'REJECTED',
        reason: '금액 형식이 올바르지 않습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    expect(outcome.rejected).toBe(1)
    expect(await pendingCount()).toBe(0)
    // 조용히 버리면 사용자는 기록이 사라진 것을 나중에 발견한다.
    const failures = await db.syncFailures.toArray()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toBe('금액 형식이 올바르지 않습니다.')
  })

  it('요청 자체가 실패하면 큐를 그대로 둔다', async () => {
    await queueExpense()
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: '서버 오류' } }, 500),
    )

    const outcome = await syncNow(USER)

    expect(outcome.error).toBe('서버 오류')
    expect(await pendingCount()).toBe(1)
  })

  it('실패 후에는 백오프 동안 재시도하지 않는다', async () => {
    await queueExpense()
    fetchMock.mockResolvedValueOnce(json({ error: { message: '서버 오류' } }, 500))
    await syncNow(USER)

    const callsAfterFailure = fetchMock.mock.calls.length
    await syncNow(USER)
    expect(fetchMock.mock.calls.length).toBe(callsAfterFailure)

    // force면 백오프를 건너뛴다 — 온라인 복귀는 "지금 바로"가 기대다.
    fetchMock
      .mockResolvedValueOnce(pushOk([
        { clientUuid: UUID_A, table: 'expenses', status: 'APPLIED', id: 1 },
      ]))
      .mockResolvedValueOnce(pullEmpty())
    await syncNow(USER, true)
    expect(await pendingCount()).toBe(0)
  })

  it('동시에 불러도 한 번만 실행된다', async () => {
    await queueExpense()
    fetchMock
      .mockResolvedValueOnce(pushOk([
        { clientUuid: UUID_A, table: 'expenses', status: 'APPLIED', id: 1 },
      ]))
      .mockResolvedValueOnce(pullEmpty())

    const [a, b] = await Promise.all([syncNow(USER), syncNow(USER)])

    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(2) // push 1 + pull 1
  })

  it('스키마 버전을 함께 보낸다', async () => {
    await queueExpense()
    fetchMock.mockResolvedValueOnce(pushOk([])).mockResolvedValueOnce(pullEmpty())
    await syncNow(USER)

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body).schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('pull', () => {
  it('서버 변경을 로컬에 반영하고 커서를 옮긴다', async () => {
    fetchMock.mockResolvedValueOnce(json({
      changes: [expenseRow()],
      nextCursor: { syncedAt: '2026-08-10 12:00:00.500', id: 10 },
      hasMore: false,
    } satisfies PullResponse))

    const outcome = await syncNow(USER)

    expect(outcome.pulled).toBe(1)
    expect((await db.expenses.get(UUID_A))?.amount).toBe('1000')
    expect((await db.meta.get(META_KEY.lastPulledSyncedAt))?.value)
      .toBe('2026-08-10 12:00:00.500')
    expect((await db.meta.get(META_KEY.lastPulledId))?.value).toBe('10')
  })

  it('hasMore면 이어 받는다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({
        changes: [expenseRow()],
        nextCursor: { syncedAt: '2026-08-10 12:00:00.500', id: 10 },
        hasMore: true,
      } satisfies PullResponse))
      .mockResolvedValueOnce(json({
        changes: [expenseRow({ id: 11, clientUuid: UUID_B })],
        nextCursor: { syncedAt: '2026-08-10 12:00:01.000', id: 11 },
        hasMore: false,
      } satisfies PullResponse))

    const outcome = await syncNow(USER)

    expect(outcome.pulled).toBe(2)
    expect(await db.expenses.count()).toBe(2)
  })

  it('로컬이 더 최신이면 덮지 않는다 — 아직 큐에 있는 내 변경을 지키기 위해', async () => {
    await db.expenses.put({
      clientUuid: UUID_A, userId: USER, serverId: null,
      occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '내 값',
      categoryClientUuid: null, memo: null,
      updatedAt: '2026-08-10 14:00:00.000', deletedAt: null,
    })
    fetchMock.mockResolvedValueOnce(json({
      changes: [expenseRow({ updatedAt: '2026-08-10 12:00:00.000' })],
      nextCursor: { syncedAt: '2026-08-10 12:00:00.500', id: 10 },
      hasMore: false,
    } satisfies PullResponse))

    await syncNow(USER)

    const local = await db.expenses.get(UUID_A)
    expect(local?.amount).toBe('내 값')
    // 덮지 않아도 serverId는 채워야 이후 삭제가 툼스톤으로 전파된다.
    expect(local?.serverId).toBe(10)
  })

  it('툼스톤을 받으면 로컬에도 삭제 표시가 남는다', async () => {
    fetchMock.mockResolvedValueOnce(json({
      changes: [expenseRow({
        updatedAt: '2026-08-10 13:00:00.000',
        deletedAt: '2026-08-10 13:00:00.000',
      })],
      nextCursor: { syncedAt: '2026-08-10 12:00:00.500', id: 10 },
      hasMore: false,
    } satisfies PullResponse))

    await syncNow(USER)

    expect((await db.expenses.get(UUID_A))?.deletedAt).toBe('2026-08-10 13:00:00.000')
  })

  it('처음에는 초기 커서로 요청한다', async () => {
    fetchMock.mockResolvedValueOnce(pullEmpty())
    await syncNow(USER)

    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('since=1970-01-01')
    expect(String(url)).toContain('sinceId=0')
  })

  it('초기 동기화 완료 표시를 남긴다', async () => {
    fetchMock.mockResolvedValueOnce(pullEmpty())
    await syncNow(USER)
    expect((await db.meta.get(META_KEY.initialSyncDone))?.value).toBe('Y')
  })

  it('pull이 실패하면 완료 표시를 남기지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: '끊김' } }, 503))
    const outcome = await syncNow(USER)

    expect(outcome.error).toBe('끊김')
    expect(await db.meta.get(META_KEY.initialSyncDone)).toBeUndefined()
  })
})

describe('clearLocalData', () => {
  // 목록을 손으로 관리하면 새 테이블을 빠뜨리고, 그 누락은 "로그아웃해도
  // 남의 독서 기록이 기기에 남는다"는 형태로만 드러난다.
  it('모든 로컬 스토어를 비운다', async () => {
    await db.books.put({
      clientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      userId: USER, serverId: 1,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null, genre: null,
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: USER, serverId: 2,
      occurredOn: '2026-08-11', content: '좋다',
      bookClientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })
    await queueExpense()

    await clearLocalData()

    for (const table of db.tables) {
      expect(await table.count(), `${table.name}이 비지 않았다`).toBe(0)
    }
  })
})

describe('claimLocalData', () => {
  // 로그아웃 없이 계정이 바뀌는 경로가 있다 — 세션 만료, 브라우저 종료,
  // 다른 사람이 그냥 로그인. 아웃박스에는 userId 컬럼이 없으므로, 비우지 않으면
  // 앞 사용자의 미전송 변경이 새 사용자의 토큰으로 그 계정에 기록된다.
  it('주인이 다르면 로컬을 비우고 새 주인을 적는다', async () => {
    await queueExpense()
    await db.meta.put({
      key: META_KEY.lastPulledSyncedAt, value: '2026-08-11 12:00:00.000',
    })
    await db.meta.put({ key: META_KEY.userId, value: String(USER) })

    await claimLocalData(2)

    expect(await pendingCount()).toBe(0)
    expect(await db.expenses.count()).toBe(0)
    // 커서도 함께 사라져야 한다. 남으면 새 사용자의 첫 pull이 앞 사용자의
    // 커서 이후부터 시작해, 그 시점 이전 기록을 영영 받지 못한다.
    expect(await db.meta.get(META_KEY.lastPulledSyncedAt)).toBeUndefined()
    // clearLocalData가 meta까지 비우므로 새 주인은 반드시 그 뒤에 적혀야 한다.
    expect((await db.meta.get(META_KEY.userId))?.value).toBe('2')
  })

  it('주인이 같으면 아무것도 지우지 않는다', async () => {
    await queueExpense()
    await db.meta.put({ key: META_KEY.userId, value: String(USER) })

    await claimLocalData(USER)

    expect(await pendingCount()).toBe(1)
    expect(await db.expenses.count()).toBe(1)
  })

  // 이 코드가 없던 시절에 만들어진 로컬에는 주인이 적혀 있지 않다. 남의
  // 것이라는 근거가 없는데 지우면 정당한 주인의 미전송 기록을 파괴한다.
  // 이 창은 기기마다 한 번만 열려 있다 — 한 번 적히면 이후로는 비교가 선다.
  it('주인이 적혀 있지 않으면 지우지 않고 현재 사용자를 주인으로 적는다', async () => {
    await queueExpense()

    await claimLocalData(USER)

    expect(await pendingCount()).toBe(1)
    expect(await db.expenses.count()).toBe(1)
    expect((await db.meta.get(META_KEY.userId))?.value).toBe(String(USER))
  })
})
