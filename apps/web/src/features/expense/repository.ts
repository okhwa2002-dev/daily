import type { ExpenseKind } from '@daily/shared'
import { db, type LocalExpense, type LocalExpenseCategory } from '../../db/index.ts'
import { enqueue, localNow } from '../../sync/outbox.ts'

/**
 * 화면이 지출 데이터에 닿는 유일한 통로.
 *
 * 읽기·쓰기 모두 로컬 Dexie를 거친다. 화면 컴포넌트는 API를 직접 호출하지
 * 않는다 — 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너지고, 오프라인
 * 분기 코드가 화면 전체로 번진다. 서버 통신은 `sync/` 계층이 전담한다.
 */

export interface ExpenseInput {
  occurredOn: string
  kind: ExpenseKind
  amount: string
  categoryClientUuid: string | null
  memo: string | null
}

function newUuid(): string {
  return crypto.randomUUID()
}

/** 살아있는 레코드만 남긴다. deletedAt은 인덱스에 없으므로 여기서 거른다. */
function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export async function listExpensesByDate(
  userId: number,
  occurredOn: string,
): Promise<LocalExpense[]> {
  const rows = await db.expenses.where('[userId+occurredOn]')
    .equals([userId, occurredOn]).toArray()
  return live(rows)
}

export async function listExpensesInRange(
  userId: number,
  from: string,
  to: string,
): Promise<LocalExpense[]> {
  const rows = await db.expenses.where('[userId+occurredOn]')
    .between([userId, from], [userId, to], true, true).toArray()
  return live(rows).sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
}

export async function listCategories(userId: number): Promise<LocalExpenseCategory[]> {
  const rows = await db.expenseCategories.where('userId').equals(userId).toArray()
  return live(rows).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 지출을 저장하고 같은 트랜잭션에서 큐에 넣는다.
 *
 * 레코드만 쓰고 큐 적재가 실패하면 그 변경은 이 기기에만 남아 영영 서버로
 * 가지 않는다. 사용자는 다른 기기에서 기록이 비어 있는 것을 나중에 발견한다.
 */
export async function saveExpense(
  userId: number,
  input: ExpenseInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.expenses, db.outbox, async () => {
    const existing = await db.expenses.get(clientUuid)
    await db.expenses.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      occurredOn: input.occurredOn,
      kind: input.kind,
      amount: input.amount,
      categoryClientUuid: input.categoryClientUuid,
      memo: input.memo,
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'expenses',
      clientUuid,
      op: 'UPSERT',
      payload: {
        occurredOn: input.occurredOn,
        kind: input.kind,
        amount: input.amount,
        categoryClientUuid: input.categoryClientUuid,
        memo: input.memo,
      },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteExpense(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.expenses, db.outbox, async () => {
    const existing = await db.expenses.get(clientUuid)
    // 남의 레코드나 없는 레코드는 건드리지 않는다.
    if (!existing || existing.userId !== userId) return

    // 툼스톤을 남긴다. 물리 삭제하면 다른 기기로 삭제가 전파되지 않는다.
    await db.expenses.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'expenses',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}

export async function saveCategory(
  userId: number,
  name: string,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.expenseCategories, db.outbox, async () => {
    const existing = await db.expenseCategories.get(clientUuid)
    await db.expenseCategories.put({
      clientUuid, userId, serverId: existing?.serverId ?? null,
      name, updatedAt, deletedAt: null,
    })
    await enqueue({
      table: 'expense_categories',
      clientUuid,
      op: 'UPSERT',
      payload: { name },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteCategory(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.expenseCategories, db.outbox, async () => {
    const existing = await db.expenseCategories.get(clientUuid)
    if (!existing || existing.userId !== userId) return

    await db.expenseCategories.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'expense_categories',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}

/**
 * 처음 쓰는 사용자에게 기본 카테고리를 만들어 준다.
 *
 * 이미 하나라도 있으면 아무것도 하지 않는다. 매번 만들면 다른 기기에서
 * 삭제한 기본 카테고리가 되살아난다.
 */
export const DEFAULT_CATEGORY_NAMES = ['식비', '교통', '생활', '여가', '기타'] as const

export async function ensureDefaultCategories(userId: number): Promise<void> {
  const existing = await db.expenseCategories.where('userId').equals(userId).count()
  if (existing > 0) return

  for (const name of DEFAULT_CATEGORY_NAMES) {
    await saveCategory(userId, name)
  }
}
