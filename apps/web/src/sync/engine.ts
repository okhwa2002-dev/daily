import {
  INITIAL_CURSOR, SCHEMA_VERSION,
  type PullResponse, type PushResponse, type PushResult,
} from '@daily/shared'
import { db, META_KEY, type OutboxRow } from '../db/index.ts'
import { apiFetch } from '../lib/apiClient.ts'
import { applyServerRows, recordServerId } from './apply.ts'
import { localNow, markRetry, removeFromQueue, takeBatch } from './outbox.ts'

/** 한 번에 밀어 넣는 변경 수. 서버 상한(500)보다 작게 잡아 요청을 짧게 유지한다. */
const PUSH_BATCH = 100
const PULL_PAGE = 200

/**
 * push 라운드 상한.
 *
 * 정상 종료 조건이 두 개 있지만(큐가 빔 / 진전 없음), 예상 못한 서버 응답으로
 * 둘 다 성립하지 않는 경우에 브라우저 탭이 멈추는 것을 막는 마지막 방어선이다.
 */
const MAX_PUSH_ROUNDS = 50

/**
 * CONFLICT 재시도 상한.
 *
 * 부모가 REJECTED로 격리되면 자식은 영원히 CONFLICT를 반복한다. 큐에서 빠지지
 * 않으므로 `pendingCount`가 0이 되지 않고, 로그아웃 경고가 영구히 뜬다.
 * 사용자에게는 그것을 없앨 방법이 없다.
 *
 * push 주기 기준 수 분에 해당한다 — 일시적인 단절로 부모 전송이 밀리는 경우를
 * 덮기에 충분하고, 영구 실패를 무한정 끌지 않을 만큼 짧다.
 */
const MAX_CONFLICT_TRIES = 10

/** 지수 백오프 — 1s → 2s → 4s … 최대 5분 */
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 5 * 60 * 1000

export interface SyncOutcome {
  /** 서버에 반영되어 큐에서 빠진 수 (STALE 포함) */
  pushed: number
  pulled: number
  /** 큐에 남아 재시도를 기다리는 수 */
  retrying: number
  /** 영구 실패해 사용자에게 알려야 하는 수 */
  rejected: number
  error: string | null
}

const EMPTY: SyncOutcome = { pushed: 0, pulled: 0, retrying: 0, rejected: 0, error: null }

/**
 * 동시 실행 방지.
 *
 * 30초 타이머와 탭 포커스 복귀가 겹치면 같은 항목을 두 번 밀어 넣는다. 업서트가
 * 멱등이라 서버 데이터는 안 깨지지만, 두 실행이 같은 큐 항목을 각자 지우고
 * 각자 커서를 옮기면서 큐와 커서가 어긋난다.
 */
let inFlight: Promise<SyncOutcome> | null = null
let consecutiveFailures = 0
/** 이 시각(epoch ms) 이전에는 주기 실행이 재시도하지 않는다 */
let nextAttemptAt = 0

function backoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
}

/** 백오프·동시 실행 상태를 초기화한다. 로그아웃과 테스트에서 쓴다. */
export function resetSyncState(): void {
  inFlight = null
  consecutiveFailures = 0
  nextAttemptAt = 0
}

async function readMeta(key: string): Promise<string | null> {
  return (await db.meta.get(key))?.value ?? null
}

async function writeMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    { error?: { message?: string } } | null
  return body?.error?.message ?? `동기화에 실패했습니다 (${res.status}).`
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

interface BatchOutcome { cleared: number; retrying: number; rejected: number }

async function pushBatch(userId: number, batch: OutboxRow[]): Promise<BatchOutcome> {
  const res = await apiFetch('/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      changes: batch.map((row) => ({
        table: row.table,
        clientUuid: row.clientUuid,
        op: row.op,
        updatedAt: row.updatedAt,
        payload: row.payload,
      })),
    }),
  })

  // 배치 전체가 실패했다(네트워크·5xx·버전 불일치). 큐는 그대로 두고 백오프를 태운다.
  if (!res.ok) throw new Error(await errorMessage(res))

  const body = (await res.json()) as PushResponse
  // compaction이 clientUuid당 항목을 하나로 유지하므로 키가 겹치지 않는다.
  const byUuid = new Map(batch.map((row) => [row.clientUuid, row]))
  const done: number[] = []
  let retrying = 0
  let rejected = 0

  for (const result of body.results) {
    const row = byUuid.get(result.clientUuid)
    if (!row) continue

    switch (result.status) {
      case 'APPLIED':
        if (result.id !== undefined) {
          await recordServerId(result.table, result.clientUuid, result.id)
        }
        done.push(row.seq)
        break

      case 'STALE':
        // 서버가 이겼다. 로컬을 서버 값으로 맞추고 큐에서 뺀다.
        if (result.serverRow) await applyServerRows(userId, [result.serverRow])
        done.push(row.seq)
        break

      case 'CONFLICT':
        // 부모가 아직 없다 — "영구 실패"가 아니라 "아직 이르다"다.
        // 실패로 처리해 큐에서 빼면 이 레코드가 영구 소실된다.
        //
        // 다만 영원히 기다리지는 않는다. 부모가 격리됐다면 이 항목은 다시는
        // 성공하지 못하고 큐에 눌러앉는다. tryCount는 이번 시도 전의 값이다.
        if (row.tryCount + 1 >= MAX_CONFLICT_TRIES) {
          await quarantine(row, result)
          done.push(row.seq)
          rejected += 1
        } else {
          await markRetry(row.seq, result.reason ?? '부모 레코드를 기다리는 중입니다.')
          retrying += 1
        }
        break

      case 'REJECTED':
        await quarantine(row, result)
        done.push(row.seq)
        rejected += 1
        break
    }
  }

  await removeFromQueue(done)
  return { cleared: done.length, retrying, rejected }
}

/**
 * 영구 실패를 큐에서 빼되 버리지 않고 보관한다.
 *
 * 조용히 버리면 사용자는 기록이 사라진 것을 한참 뒤에 발견한다. 반대로 무한
 * 재시도하면 큐가 그 항목에서 영영 막힌다.
 */
async function quarantine(row: OutboxRow, result: PushResult): Promise<void> {
  await db.syncFailures.add({
    table: row.table,
    clientUuid: row.clientUuid,
    op: row.op,
    payload: row.payload,
    reason: result.reason ?? '서버가 이 변경을 거부했습니다.',
    failedAt: localNow(),
  })
}

async function pushAll(userId: number, outcome: SyncOutcome): Promise<void> {
  for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    const batch = await takeBatch(PUSH_BATCH)
    if (batch.length === 0) return

    const r = await pushBatch(userId, batch)
    outcome.pushed += r.cleared - r.rejected
    outcome.rejected += r.rejected
    outcome.retrying = r.retrying

    // 큐에서 아무것도 빠지지 않았다 — 남은 것이 전부 재시도 대기다.
    // 다시 돌려도 같은 응답이 온다.
    if (r.cleared === 0) return
    // 배치를 다 채우지 못했다면 큐를 끝까지 훑은 것이다.
    if (batch.length < PUSH_BATCH) return
  }
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

/**
 * 커서 이후의 변경을 전부 받는다.
 *
 * `hasMore`가 참인 동안 이어 받는다. 첫 페이지에서 멈추면 새 기기의 초기
 * 동기화가 반쪽으로 끝나고, 사용자는 기록이 유실된 것으로 오해한다.
 */
async function pullAll(userId: number): Promise<number> {
  let syncedAt = (await readMeta(META_KEY.lastPulledSyncedAt)) ?? INITIAL_CURSOR.syncedAt
  let id = Number((await readMeta(META_KEY.lastPulledId)) ?? INITIAL_CURSOR.id)
  let total = 0

  for (;;) {
    const qs = new URLSearchParams({
      since: syncedAt, sinceId: String(id), limit: String(PULL_PAGE),
    })
    const res = await apiFetch(`/sync/pull?${qs.toString()}`)
    if (!res.ok) throw new Error(await errorMessage(res))

    const body = (await res.json()) as PullResponse
    if (body.changes.length > 0) {
      await applyServerRows(userId, body.changes)
      total += body.changes.length
    }

    // 커서는 서버가 준 값만 쓴다. 직접 계산하면 경계에서 행을 건너뛴다.
    if (!body.nextCursor) break
    syncedAt = body.nextCursor.syncedAt
    id = body.nextCursor.id
    await writeMeta(META_KEY.lastPulledSyncedAt, syncedAt)
    await writeMeta(META_KEY.lastPulledId, String(id))

    if (!body.hasMore) break
  }

  return total
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

async function runSync(userId: number): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { ...EMPTY }

  try {
    // push를 먼저 한다. 내 변경을 올린 뒤 받아야 방금 올린 것이 그대로 돌아온다.
    await pushAll(userId, outcome)
    outcome.pulled = await pullAll(userId)
    await writeMeta(META_KEY.initialSyncDone, 'Y')

    consecutiveFailures = 0
    nextAttemptAt = 0
  } catch (err) {
    consecutiveFailures += 1
    nextAttemptAt = Date.now() + backoffMs(consecutiveFailures)
    outcome.error = err instanceof Error ? err.message : '동기화에 실패했습니다.'
  }

  return outcome
}

/**
 * 동기화를 1회 실행한다.
 *
 * 이미 실행 중이면 그 실행을 기다린다. 백오프 중이면 아무것도 하지 않는다
 * (`force`가 참이면 백오프를 건너뛴다).
 */
export async function syncNow(userId: number, force = false): Promise<SyncOutcome> {
  if (inFlight) return inFlight
  if (!force && Date.now() < nextAttemptAt) return { ...EMPTY }

  inFlight = runSync(userId).finally(() => { inFlight = null })
  return inFlight
}

/** 초기 동기화가 끝났는지. 끝나기 전 화면을 열면 데이터가 부분만 보인다. */
export async function isInitialSyncDone(): Promise<boolean> {
  return (await readMeta(META_KEY.initialSyncDone)) === 'Y'
}

export interface SyncTriggerOptions {
  intervalMs?: number
  onOutcome?: (outcome: SyncOutcome) => void
}

/**
 * 동기화 트리거를 건다. 반환된 함수를 호출하면 전부 해제한다.
 *
 * 앱 시작 / `online` 이벤트 / 탭 포커스 복귀 / 30초 주기. 웹소켓·푸시는 쓰지
 * 않는다 — 개인 기록 앱이라 실시간성이 필요 없고, 자체 운영 VPS에 상시 연결을
 * 얹을 이유가 없다.
 */
export function startSync(
  userId: number,
  { intervalMs = 30_000, onOutcome }: SyncTriggerOptions = {},
): () => void {
  const report = (outcome: SyncOutcome) => onOutcome?.(outcome)
  const run = () => { void syncNow(userId).then(report) }
  // 온라인 복귀와 포커스 복귀는 "지금 바로"가 사용자 기대다. 백오프를 건너뛴다.
  const runNow = () => { void syncNow(userId, true).then(report) }
  const onVisible = () => { if (document.visibilityState === 'visible') runNow() }

  window.addEventListener('online', runNow)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(run, intervalMs)
  run()

  return () => {
    window.removeEventListener('online', runNow)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}

/**
 * 로컬 데이터를 전부 비운다. 로그아웃 시 호출한다.
 *
 * 개인 기록이 기기에 남으면 다음 사용자가 그대로 본다. 큐에 남은 변경도 함께
 * 사라지므로, 로그아웃 전에 동기화를 끝내는 것은 호출부 책임이다.
 */
export async function clearLocalData(): Promise<void> {
  resetSyncState()
  await db.transaction('rw',
    db.expenses, db.expenseCategories, db.outbox, db.meta, db.syncFailures,
    async () => {
      await db.expenses.clear()
      await db.expenseCategories.clear()
      await db.outbox.clear()
      await db.meta.clear()
      await db.syncFailures.clear()
    })
}
