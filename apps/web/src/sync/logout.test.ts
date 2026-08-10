import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { enqueue } from './outbox.ts'
import { resetSyncState } from './engine.ts'
import { logoutSafely } from './logout.ts'

const USER = 1
const UUID = 'aaaaaaaa-0000-4000-8000-000000000001'

const fetchMock = vi.fn()
const logout = vi.fn(async () => {})

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  logout.mockClear()
  setAccessToken('token')
  resetSyncState()
  setOnline(true)
  await db.outbox.clear()
  await db.meta.clear()
  await db.expenses.clear()
  await db.expenseCategories.clear()
  await db.syncFailures.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

async function queueOne() {
  await db.expenses.put({
    clientUuid: UUID, userId: USER, serverId: null,
    occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '1000',
    categoryClientUuid: null, memo: null,
    updatedAt: '2026-08-10 12:00:00.000', deletedAt: null,
  })
  await enqueue({
    table: 'expenses', clientUuid: UUID, op: 'UPSERT',
    payload: {}, updatedAt: '2026-08-10 12:00:00.000', everSynced: false,
  })
}

describe('logoutSafely', () => {
  it('큐가 비어 있으면 바로 로그아웃하고 로컬을 비운다', async () => {
    await db.expenses.put({
      clientUuid: UUID, userId: USER, serverId: 1,
      occurredOn: '2026-08-10', kind: 'EXPENSE', amount: '1000',
      categoryClientUuid: null, memo: null,
      updatedAt: '2026-08-10 12:00:00.000', deletedAt: null,
    })
    const confirmDiscard = vi.fn(() => true)

    const outcome = await logoutSafely({ userId: USER, logout, confirmDiscard })

    expect(outcome).toBe('DONE')
    expect(confirmDiscard).not.toHaveBeenCalled()
    // 공용 기기에서 다음 사용자가 남의 기록을 보면 안 된다.
    expect(await db.expenses.count()).toBe(0)
  })

  it('온라인이면 먼저 전송하고 로그아웃한다', async () => {
    await queueOne()
    fetchMock
      .mockResolvedValueOnce(json({
        results: [{ clientUuid: UUID, table: 'expenses', status: 'APPLIED', id: 1 }],
        serverTime: '2026-08-10 12:00:00.000',
      }))
      .mockResolvedValueOnce(json({ changes: [], nextCursor: null, hasMore: false }))
    const confirmDiscard = vi.fn(() => true)

    const outcome = await logoutSafely({ userId: USER, logout, confirmDiscard })

    expect(outcome).toBe('DONE')
    // 전송에 성공했으므로 물어볼 이유가 없다.
    expect(confirmDiscard).not.toHaveBeenCalled()
    expect(logout).toHaveBeenCalled()
  })

  it('오프라인이면 확인을 받고서야 로그아웃한다', async () => {
    await queueOne()
    setOnline(false)
    const confirmDiscard = vi.fn(() => true)

    const outcome = await logoutSafely({ userId: USER, logout, confirmDiscard })

    expect(confirmDiscard).toHaveBeenCalledWith(1)
    expect(outcome).toBe('DONE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('사용자가 취소하면 로그아웃하지 않고 데이터도 남긴다', async () => {
    await queueOne()
    setOnline(false)
    const confirmDiscard = vi.fn(() => false)

    const outcome = await logoutSafely({ userId: USER, logout, confirmDiscard })

    expect(outcome).toBe('CANCELLED')
    expect(logout).not.toHaveBeenCalled()
    // 오프라인에서 여러 날 기록한 데이터를 한 번에 잃는 경로를 막는다.
    expect(await db.expenses.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('전송이 실패해 큐가 남으면 확인을 받는다', async () => {
    await queueOne()
    fetchMock.mockResolvedValueOnce(json({ error: { message: '끊김' } }, 503))
    const confirmDiscard = vi.fn(() => false)

    const outcome = await logoutSafely({ userId: USER, logout, confirmDiscard })

    expect(confirmDiscard).toHaveBeenCalledWith(1)
    expect(outcome).toBe('CANCELLED')
  })
})
