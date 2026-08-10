import { toKstTimestamp, type OutboxOp, type SyncTable } from '@daily/shared'
import { db, type OutboxRow } from '../db/index.ts'

/** 현재 시각을 서버와 같은 KST 벽시계 형식으로 만든다. */
export function localNow(): string {
  return toKstTimestamp(new Date())
}

interface EnqueueInput {
  table: SyncTable
  clientUuid: string
  op: OutboxOp
  payload?: unknown
  updatedAt: string
  /** 이 레코드가 서버에 한 번이라도 올라간 적이 있는지 */
  everSynced: boolean
}

/**
 * 변경을 아웃박스에 넣는다. 같은 레코드의 앞선 항목은 compaction 규칙으로 접는다.
 *
 * | 앞 | 뒤 | 결과 |
 * |---|---|---|
 * | UPSERT | UPSERT | 마지막 것만 남긴다 |
 * | UPSERT | DELETE | DELETE만 남긴다 |
 * | (서버 미전송) UPSERT | DELETE | 둘 다 제거한다 |
 *
 * compaction을 하지 않으면 일기처럼 타이핑 중 계속 저장되는 데이터가 큐를
 * 수백 줄로 채운다.
 *
 * **`seq`는 가장 오래된 항목의 값을 유지한다.** 새 seq를 받으면 부모보다 자식이
 * 먼저 나가고, 서버는 부모를 못 찾아 CONFLICT를 반복한다.
 */
export async function enqueue(input: EnqueueInput): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const previous = await db.outbox.where('clientUuid').equals(input.clientUuid).toArray()
    const oldestSeq = previous.length > 0
      ? Math.min(...previous.map((row) => row.seq))
      : null

    if (previous.length > 0) {
      await db.outbox.bulkDelete(previous.map((row) => row.seq))
    }

    // 서버가 모르는 레코드를 지웠다. 툼스톤을 보낼 이유가 없다.
    if (input.op === 'DELETE' && !input.everSynced) return

    const row: Omit<OutboxRow, 'seq'> & { seq?: number } = {
      table: input.table,
      clientUuid: input.clientUuid,
      op: input.op,
      payload: input.payload ?? null,
      updatedAt: input.updatedAt,
      tryCount: 0,
      lastError: null,
      queuedAt: localNow(),
    }
    if (oldestSeq !== null) row.seq = oldestSeq

    await db.outbox.put(row as OutboxRow)
  })
}

/** 전송 대기 중인 변경 수. 화면에 항상 보여준다. */
export async function pendingCount(): Promise<number> {
  return db.outbox.count()
}

/** seq 순서대로 배치를 꺼낸다. 이 순서가 부모-자식 순서를 보장한다. */
export async function takeBatch(limit: number): Promise<OutboxRow[]> {
  return db.outbox.orderBy('seq').limit(limit).toArray()
}

/** 전송에 성공(또는 영구 실패)한 항목을 큐에서 제거한다. */
export async function removeFromQueue(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return
  await db.outbox.bulkDelete(seqs)
}

/**
 * 재시도 대상으로 표시한다.
 *
 * 큐에 남겨야 하는 실패(네트워크·5xx·부모 아직 없음)에만 쓴다. 영구 실패를
 * 여기로 보내면 큐가 그 항목에서 영영 막힌다.
 */
export async function markRetry(seq: number, error: string): Promise<void> {
  await db.outbox.where('seq').equals(seq).modify((row) => {
    row.tryCount += 1
    row.lastError = error
  })
}
