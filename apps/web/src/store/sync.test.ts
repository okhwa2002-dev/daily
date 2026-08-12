import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullResponse } from '@daily/shared'
import { db, META_KEY } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { resetSyncState } from '../sync/engine.ts'
import { enqueue, pendingCount } from '../sync/outbox.ts'
import { useSync } from './sync.ts'

const PREVIOUS_USER = 1
const NEXT_USER = 2
const UUID = 'aaaaaaaa-0000-4000-8000-000000000001'

const fetchMock = vi.fn()

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(
    JSON.stringify({ changes: [], nextCursor: null, hasMore: false } satisfies PullResponse),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  setAccessToken('token')
  resetSyncState()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterEach(() => {
  // start가 건 타이머와 이벤트 리스너를 걷어낸다. 남기면 다음 테스트로 샌다.
  useSync.getState().stop()
  vi.unstubAllGlobals()
})

/** 앞 사용자가 로그아웃하지 않고 떠난 기기를 만든다. */
async function leaveBehindPreviousUser() {
  await db.expenses.put({
    clientUuid: UUID, userId: PREVIOUS_USER, serverId: null,
    occurredOn: '2026-08-11', kind: 'EXPENSE', amount: '1000',
    categoryClientUuid: null, memo: null,
    updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
  })
  await enqueue({
    table: 'expenses', clientUuid: UUID, op: 'UPSERT',
    payload: {
      occurredOn: '2026-08-11', kind: 'EXPENSE', amount: '1000',
      categoryClientUuid: null, memo: null,
    },
    updatedAt: '2026-08-11 12:00:00.000', everSynced: false,
  })
  await db.meta.put({
    key: META_KEY.lastPulledSyncedAt, value: '2026-08-11 12:00:00.000',
  })
  await db.meta.put({ key: META_KEY.userId, value: String(PREVIOUS_USER) })
}

describe('useSync.start', () => {
  /**
   * 이 배선이 빠지면 `claimLocalData`가 아무리 정확해도 호출되지 않는다 —
   * 이 결함이 정확히 그런 모양이었다. `META_KEY.userId`는 정의만 되어 있고
   * 읽는 곳도 쓰는 곳도 없었다. 그러니 함수가 아니라 **호출 경로**를 검증한다.
   */
  it('앞 사용자의 로컬을 비운 뒤에 동기화를 시작한다', async () => {
    await leaveBehindPreviousUser()

    await useSync.getState().start(NEXT_USER)

    // 아웃박스에는 userId 컬럼이 없다. 남아 있으면 앞 사용자의 미전송 변경이
    // 이 사용자의 토큰으로 올라가 이 사용자의 계정에 기록된다.
    expect(await pendingCount()).toBe(0)
    expect(await db.expenses.count()).toBe(0)
    // 커서가 남으면 이 사용자의 첫 pull이 앞 사용자의 커서 이후부터 시작해
    // 그 시점 이전 기록을 영영 받지 못한다.
    expect(await db.meta.get(META_KEY.lastPulledSyncedAt)).toBeUndefined()
    expect((await db.meta.get(META_KEY.userId))?.value).toBe(String(NEXT_USER))
  })

  it('같은 사용자가 다시 시작하면 미전송 큐를 지킨다', async () => {
    await leaveBehindPreviousUser()

    await useSync.getState().start(PREVIOUS_USER)

    // 앱을 다시 열 때마다 지나가는 경로다. 여기서 지우면 오프라인에서 쌓은
    // 기록이 재시작만으로 사라진다.
    expect(await pendingCount()).toBe(1)
    expect(await db.expenses.count()).toBe(1)
  })
})
