import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, type PullResponse, type PushResponse } from '@daily/shared'
import { db, META_KEY } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { enqueue, pendingCount, takeBatch } from './outbox.ts'
import { resetSyncState, syncNow } from './engine.ts'

const USER = 1
const UUID_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const UUID_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const fetchMock = vi.fn()

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken('token')
  resetSyncState()
  await db.outbox.clear()
  await db.meta.clear()
  await db.expenses.clear()
  await db.expenseCategories.clear()
  await db.syncFailures.clear()
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
