import { and, eq, lt } from 'drizzle-orm'
import {
  normalizeClientTimestamp,
  type PushResult, type SyncChange, type SyncRow, type SyncTable,
} from '@daily/shared'
import { db } from '../db/pool.ts'
import { ownedBy } from '../db/ownership.ts'
import { dbNow, padMillis } from '../db/time.ts'
import {
  SYNC_REGISTRY, type AnyPayload, type ColumnValues, type SyncTableDef,
} from './registry.ts'

/**
 * drizzle의 insert/update는 테이블별 구체 타입을 요구한다. 엔진은 테이블을
 * 모른 채 동작해야 하므로 이 지점에서만 타입을 푼다. 값의 모양은 레지스트리의
 * `toColumns`가 책임진다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicTable = any

type Def = SyncTableDef<AnyPayload>

/** DB row → pull/push 응답용 행. */
export function toSyncRow(
  table: SyncTable,
  def: Def,
  row: ColumnValues,
): SyncRow {
  return {
    table,
    id: Number(row.id),
    clientUuid: String(row.clientUuid),
    occurredOn: def.hasOccurredOn ? String(row.occurredOn) : null,
    // 밀리초 자릿수를 고정한다. 이유는 padMillis 주석 참고 — 빠뜨리면
    // 클라이언트가 서버 값을 항상 "더 오래됨"으로 보고 재전송을 반복한다.
    updatedAt: padMillis(String(row.updatedAt)),
    syncedAt: padMillis(String(row.syncedAt)),
    deletedAt: row.deletedAt === null || row.deletedAt === undefined
      ? null
      : padMillis(String(row.deletedAt)),
    payload: def.toPayload(row),
  }
}

async function findByClientUuid(
  def: Def,
  userId: number,
  clientUuid: string,
): Promise<ColumnValues | undefined> {
  const [row] = await db.select().from(def.table as DynamicTable)
    .where(ownedBy(def.table, userId, eq(def.table.clientUuid, clientUuid)))
  return row as ColumnValues | undefined
}

/**
 * 부모 레코드의 서버 id를 찾는다.
 *
 * `ownedBy`를 쓰고 `liveOwnedBy`를 쓰지 않는 것이 중요하다. 삭제된 부모도
 * 찾아야 한다 — 카테고리를 지운 뒤 그 카테고리를 쓰던 지출이 올라오면,
 * 툼스톤을 제외할 경우 영원히 CONFLICT가 되어 큐가 그 항목에서 영영 막힌다.
 */
async function resolveParentId(
  def: Def,
  userId: number,
  payload: ColumnValues,
): Promise<{ ok: true; id: number | null } | { ok: false; reason: string }> {
  if (!def.parent) return { ok: true, id: null }

  const uuid = payload[def.parent.uuidField]
  if (uuid === null || uuid === undefined) {
    return def.parent.required
      ? { ok: false, reason: '부모 레코드가 지정되지 않았습니다.' }
      : { ok: true, id: null }
  }

  const parent = def.parent.parentTable
  const [found] = await db.select({ id: parent.id }).from(parent as DynamicTable)
    .where(ownedBy(parent, userId, eq(parent.clientUuid, String(uuid))))

  return found
    ? { ok: true, id: Number((found as { id: unknown }).id) }
    : { ok: false, reason: '부모 레코드가 아직 서버에 없습니다.' }
}

/**
 * 변경 한 건을 적용한다.
 *
 * 항목별로 독립 처리한다. 전체를 한 트랜잭션으로 묶으면 한 레코드가 깨졌을 때
 * 그 기기의 동기화가 영영 막힌다. `synced_at`도 항목마다 찍는다 — 배치 시작
 * 시각으로 통일하면 긴 배치에서 "찍은 시각과 커밋 시각의 간격"이 벌어져,
 * pull의 정착 지연(1초)이 그 간격을 못 덮고 행이 누락된다.
 */
export async function applyChange(userId: number, change: SyncChange): Promise<PushResult> {
  const def = SYNC_REGISTRY[change.table]
  const base = { clientUuid: change.clientUuid, table: change.table }

  let updatedAt: string
  try {
    updatedAt = normalizeClientTimestamp(change.updatedAt)
  } catch (err) {
    return {
      ...base,
      status: 'REJECTED',
      reason: err instanceof Error ? err.message : '수정 시각을 해석할 수 없습니다.',
    }
  }

  return change.op === 'DELETE'
    ? applyDelete(userId, change, def, updatedAt, base)
    : applyUpsert(userId, change, def, updatedAt, base)
}

type ResultBase = { clientUuid: string; table: SyncTable }

async function applyUpsert(
  userId: number,
  change: SyncChange,
  def: Def,
  updatedAt: string,
  base: ResultBase,
): Promise<PushResult> {
  const parsed = def.payload.safeParse(change.payload)
  if (!parsed.success) {
    return {
      ...base,
      status: 'REJECTED',
      reason: parsed.error.issues[0]?.message ?? '레코드 형식이 올바르지 않습니다.',
    }
  }

  const parent = await resolveParentId(def, userId, parsed.data as ColumnValues)
  if (!parent.ok) {
    // 부모 없음은 영구 실패가 아니라 "아직 이르다"다. 큐에 남겨 재시도하게 한다.
    return { ...base, status: 'CONFLICT', reason: parent.reason }
  }

  // DB를 봐야 하는 검증. 실패는 영구 실패다 — 재시도해도 계속 틀린 값이다.
  if (def.validate) {
    const reason = await def.validate(parsed.data)
    if (reason !== null) return { ...base, status: 'REJECTED', reason }
  }

  const domain = def.toColumns(parsed.data, parent.id)
  const now = dbNow()

  const upserted = await db.insert(def.table as DynamicTable).values({
    ...domain,
    clientUuid: change.clientUuid,
    userId,
    syncedAt: now,
    createdAt: updatedAt,
    createdBy: userId,
    updatedAt,
    updatedBy: userId,
  }).onConflictDoUpdate({
    target: [def.table.userId, def.table.clientUuid],
    // created_* 는 갱신하지 않는다. 최초 등록 정보가 덮이면 안 된다.
    // 되살아나는 경우를 위해 deleted_* 를 명시적으로 비운다.
    set: {
      ...domain,
      syncedAt: now,
      updatedAt,
      updatedBy: userId,
      deletedAt: null,
      deletedBy: null,
    },
    // last-write-wins. 오래된 변경이 최신 값을 덮지 못한다.
    setWhere: lt(def.table.updatedAt, updatedAt),
  }).returning() as ColumnValues[]

  const inserted = upserted[0]
  if (inserted) {
    return { ...base, status: 'APPLIED', id: Number(inserted.id) }
  }

  // setWhere가 거짓이라 아무것도 안 바뀌었다 — 서버 값이 같거나 더 최신이다.
  const current = await findByClientUuid(def, userId, change.clientUuid)
  if (!current) {
    // 여기 오면 안 된다. 충돌했는데 그 행을 못 찾는다는 뜻이다.
    return { ...base, status: 'REJECTED', reason: '레코드를 저장하지 못했습니다.' }
  }
  return {
    ...base,
    status: 'STALE',
    id: Number(current.id),
    serverRow: toSyncRow(change.table, def, current),
  }
}

async function applyDelete(
  userId: number,
  change: SyncChange,
  def: Def,
  updatedAt: string,
  base: ResultBase,
): Promise<PushResult> {
  const now = dbNow()

  const updated = await db.update(def.table as DynamicTable)
    .set({
      deletedAt: updatedAt,
      deletedBy: userId,
      updatedAt,
      updatedBy: userId,
      syncedAt: now,
    })
    // 삭제도 LWW를 탄다. 오래된 삭제가 그 뒤의 수정을 덮으면 안 된다.
    .where(and(
      ownedBy(def.table, userId, eq(def.table.clientUuid, change.clientUuid)),
      lt(def.table.updatedAt, updatedAt),
    ))
    .returning() as ColumnValues[]

  const deleted = updated[0]
  if (deleted) {
    return { ...base, status: 'APPLIED', id: Number(deleted.id) }
  }

  const current = await findByClientUuid(def, userId, change.clientUuid)
  if (!current) {
    // 서버가 모르는 레코드의 삭제다. 전파할 것이 없으므로 큐에서 내보낸다.
    return { ...base, status: 'APPLIED' }
  }
  return {
    ...base,
    status: 'STALE',
    id: Number(current.id),
    serverRow: toSyncRow(change.table, def, current),
  }
}

/** 배치를 순서대로 적용한다. 부모-자식이 같은 배치에 있으면 순서가 곧 보장이다. */
export async function applyChanges(
  userId: number,
  changes: SyncChange[],
): Promise<PushResult[]> {
  const results: PushResult[] = []
  for (const change of changes) {
    results.push(await applyChange(userId, change))
  }
  return results
}

/** 서버 현재 시각 (KST 벽시계). */
export function serverTime(): string {
  return dbNow()
}

