import { and, asc, eq, gt, lte, or } from 'drizzle-orm'
import {
  PULL_MAX_LIMIT, SYNC_TABLE,
  type PullCursor, type PullResponse, type SyncRow, type SyncTable,
} from '@daily/shared'
import { db } from '../db/pool.ts'
import { ownedBy } from '../db/ownership.ts'
import { dbNowMinus } from '../db/time.ts'
import { SYNC_REGISTRY } from './registry.ts'
import { toSyncRow } from './push.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicTable = any

/**
 * 정착 지연.
 *
 * 트랜잭션은 `synced_at`을 찍는 시점과 커밋 시점이 다르다. `synced_at = T`인 행이
 * `T+50ms`에 커밋되면, `T+10ms`에 커서 `T`로 돌아간 pull은 그 행을 **영영** 못 본다 —
 * 커서가 이미 지나가 버렸기 때문이다. 아직 덜 굳은 구간을 통째로 빼서 막는다.
 *
 * 대가는 다른 기기의 변경이 최대 1초 늦게 보이는 것이고, 폴링 주기가 30초라
 * 사용자가 느낄 수 있는 차이가 아니다.
 */
const SETTLING_MS = 1000

/**
 * 커서 이후의 변경을 테이블 구분 없이 시간순으로 내려보낸다.
 *
 * 툼스톤도 포함한다. 삭제가 전파되지 않으면 다른 기기에 유령 레코드가 남는다.
 * 이 쿼리만 `deleted_at IS NULL` 조건의 예외다.
 */
export async function pullChanges(
  userId: number,
  cursor: PullCursor,
  limit: number,
): Promise<PullResponse> {
  const capped = Math.min(Math.max(limit, 1), PULL_MAX_LIMIT)
  const settled = dbNowMinus(SETTLING_MS)

  // 테이블마다 따로 읽고 합쳐서 정렬한다. UNION ALL을 손으로 짜는 것보다
  // 테이블을 추가할 때 고칠 곳이 없다. 각 테이블에서 최대 (capped + 1)행만
  // 읽으므로 테이블이 늘어도 메모리는 선형이다.
  const perTable = await Promise.all(
    SYNC_TABLE.map(async (name: SyncTable) => {
      const def = SYNC_REGISTRY[name]
      const rows = await db.select().from(def.table as DynamicTable)
        .where(and(
          ownedBy(def.table, userId),
          // (synced_at, id) 복합 커서. 같은 시각에 저장된 행이 여러 개일 때
          // 타임스탬프만으로는 경계에서 행이 누락되거나 같은 행을 무한 반복한다.
          or(
            gt(def.table.syncedAt, cursor.syncedAt),
            and(eq(def.table.syncedAt, cursor.syncedAt), gt(def.table.id, cursor.id)),
          ),
          lte(def.table.syncedAt, settled),
        ))
        .orderBy(asc(def.table.syncedAt), asc(def.table.id))
        .limit(capped + 1)

      return (rows as Record<string, unknown>[]).map((r) => toSyncRow(name, def, r))
    }),
  )

  const merged = perTable.flat().sort(compareByCursor)
  const page = merged.slice(0, capped)
  const hasMore = merged.length > capped

  return {
    changes: page,
    // 커서는 **실제로 내려보낸 마지막 행**에서 만든다. 서버 현재 시각을 쓰면
    // 그 사이에 커밋된 행을 영구히 건너뛴다.
    nextCursor: page.length > 0
      ? { syncedAt: page[page.length - 1]!.syncedAt, id: page[page.length - 1]!.id }
      : null,
    hasMore,
  }
}

/** `(synced_at, id)` 순. 테이블이 달라도 같은 축으로 줄을 세운다. */
function compareByCursor(a: SyncRow, b: SyncRow): number {
  if (a.syncedAt !== b.syncedAt) return a.syncedAt < b.syncedAt ? -1 : 1
  return a.id - b.id
}
