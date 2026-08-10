import type { ExpenseKind, SyncRow, SyncTable } from '@daily/shared'
import { db } from '../db/index.ts'

/**
 * 서버에서 내려온 행을 로컬에 반영한다.
 *
 * **로컬이 더 최신이면 덮지 않는다.** 아직 큐에 남아 있는 내 변경을 서버 값으로
 * 덮으면, 그 변경은 push 되기도 전에 사라진다. 로컬이 이기는 경우에도 `serverId`는
 * 채워야 한다 — 이 값이 있어야 이후 삭제가 툼스톤으로 전파된다.
 *
 * 시각 비교가 문자열 비교인 것은 의도한 것이다. KST 벽시계 형식이 고정 폭이라
 * 사전순과 시간순이 일치한다. 서버가 밀리초를 3자리로 채워 보내는 것이 이 전제를
 * 지탱한다 (api의 `padMillis` 참고).
 */
async function applyToTable<T extends { updatedAt: string; serverId: number | null }>(
  table: {
    get(key: string): Promise<T | undefined>
    put(item: T): Promise<unknown>
    update(key: string, changes: Partial<T>): Promise<unknown>
  },
  userId: number,
  row: SyncRow,
  build: (row: SyncRow) => T,
): Promise<void> {
  const local = await table.get(row.clientUuid)

  if (local && local.updatedAt >= row.updatedAt) {
    if (local.serverId === null) {
      await table.update(row.clientUuid, { serverId: row.id } as Partial<T>)
    }
    return
  }
  await table.put({ ...build(row), userId } as T)
}

const APPLIERS: Record<SyncTable, (userId: number, row: SyncRow) => Promise<void>> = {
  expenses: (userId, row) => applyToTable(db.expenses, userId, row, (r) => ({
    clientUuid: r.clientUuid,
    userId,
    serverId: r.id,
    occurredOn: String(r.payload.occurredOn),
    kind: r.payload.kind as ExpenseKind,
    amount: String(r.payload.amount),
    categoryClientUuid: (r.payload.categoryClientUuid as string | null) ?? null,
    memo: (r.payload.memo as string | null) ?? null,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  })),

  expense_categories: (userId, row) => applyToTable(
    db.expenseCategories, userId, row, (r) => ({
      clientUuid: r.clientUuid,
      userId,
      serverId: r.id,
      name: String(r.payload.name),
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    }),
  ),
}

/** pull로 받은 변경을 순서대로 반영한다. */
export async function applyServerRows(userId: number, rows: SyncRow[]): Promise<void> {
  for (const row of rows) {
    await APPLIERS[row.table](userId, row)
  }
}

/** push 응답의 서버 id를 로컬 레코드에 기록한다. */
export async function recordServerId(
  table: SyncTable,
  clientUuid: string,
  serverId: number,
): Promise<void> {
  const target = table === 'expenses' ? db.expenses : db.expenseCategories
  await target.update(clientUuid, { serverId })
}
