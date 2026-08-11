import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { takeBatch } from '../../sync/outbox.ts'
import {
  DEFAULT_CATEGORY_NAMES, deleteCategory, deleteExpense, ensureDefaultCategories,
  listCategories, listExpensesByDate, saveCategory, saveExpense,
} from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-10'

const input = (over: Record<string, unknown> = {}) => ({
  occurredOn: TODAY, kind: 'EXPENSE' as const, amount: '1000',
  categoryClientUuid: null, memo: null, ...over,
})

beforeEach(async () => {
  await db.expenses.clear()
  await db.expenseCategories.clear()
  await db.outbox.clear()
})

describe('지출 저장', () => {
  it('로컬에 저장하고 같은 동작으로 큐에 넣는다', async () => {
    const uuid = await saveExpense(USER, input({ memo: '점심' }))

    const rows = await listExpensesByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.memo).toBe('점심')
    // 레코드만 쓰고 큐 적재가 빠지면 그 변경은 이 기기에만 남는다.
    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.clientUuid).toBe(uuid)
  })

  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveExpense(USER, input())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort())
      .toEqual(['amount', 'categoryClientUuid', 'kind', 'memo', 'occurredOn'])
  })

  it('같은 clientUuid로 다시 저장하면 수정이다', async () => {
    const uuid = await saveExpense(USER, input({ amount: '1000' }))
    await saveExpense(USER, input({ amount: '2000' }), uuid)

    const rows = await listExpensesByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe('2000')
    // compaction으로 큐에도 한 건만 남는다.
    expect(await takeBatch(10)).toHaveLength(1)
  })

  it('다른 날짜의 기록은 섞이지 않는다', async () => {
    await saveExpense(USER, input({ occurredOn: TODAY }))
    await saveExpense(USER, input({ occurredOn: '2026-08-11' }))
    expect(await listExpensesByDate(USER, TODAY)).toHaveLength(1)
  })

  it('다른 사용자의 기록은 보이지 않는다', async () => {
    await saveExpense(USER, input())
    await saveExpense(OTHER, input())
    expect(await listExpensesByDate(USER, TODAY)).toHaveLength(1)
  })
})

describe('지출 삭제', () => {
  it('물리 삭제하지 않고 툼스톤을 남긴다', async () => {
    const uuid = await saveExpense(USER, input())
    await db.expenses.update(uuid, { serverId: 7 })
    await db.outbox.clear()

    await deleteExpense(USER, uuid)

    // 목록에서는 사라지지만 레코드 자체는 남아야 다른 기기로 전파된다.
    expect(await listExpensesByDate(USER, TODAY)).toHaveLength(0)
    expect((await db.expenses.get(uuid))?.deletedAt).not.toBeNull()
    const queue = await takeBatch(10)
    expect(queue[0]?.op).toBe('DELETE')
  })

  it('서버가 모르는 기록을 지우면 큐에 아무것도 남지 않는다', async () => {
    const uuid = await saveExpense(USER, input())
    await deleteExpense(USER, uuid)
    expect(await takeBatch(10)).toHaveLength(0)
  })

  it('남의 기록은 지우지 않는다', async () => {
    const uuid = await saveExpense(OTHER, input())
    await db.outbox.clear()

    await deleteExpense(USER, uuid)

    expect((await db.expenses.get(uuid))?.deletedAt).toBeNull()
    expect(await takeBatch(10)).toHaveLength(0)
  })
})

describe('카테고리', () => {
  it('처음 한 번만 기본 세트를 만든다', async () => {
    await ensureDefaultCategories(USER)
    expect(await listCategories(USER)).toHaveLength(DEFAULT_CATEGORY_NAMES.length)

    await ensureDefaultCategories(USER)
    expect(await listCategories(USER)).toHaveLength(DEFAULT_CATEGORY_NAMES.length)
  })

  it('삭제한 기본 카테고리가 되살아나지 않는다', async () => {
    await ensureDefaultCategories(USER)
    const [first] = await listCategories(USER)
    await deleteCategory(USER, first!.clientUuid)

    await ensureDefaultCategories(USER)

    expect(await listCategories(USER)).toHaveLength(DEFAULT_CATEGORY_NAMES.length - 1)
  })

  it('동시에 두 번 호출해도 기본 세트는 한 벌만 생긴다', async () => {
    // StrictMode는 마운트 이펙트를 두 번 돌린다. 두 호출이 겹치면 둘 다
    // count 0을 보고 각자 한 벌씩 만든다 — 화면에 같은 이름이 두 번 뜬다.
    await Promise.all([ensureDefaultCategories(USER), ensureDefaultCategories(USER)])

    expect(await listCategories(USER)).toHaveLength(DEFAULT_CATEGORY_NAMES.length)
  })

  it('같은 이름을 여러 개 만들 수 있다 — 유니크 제약을 걸지 않는다', async () => {
    // 두 기기에서 오프라인으로 같은 이름을 만들면 제약 위반이 400(영구 실패)이
    // 되어 사용자 입력이 큐에서 버려진다. 중복은 화면에서 다룬다.
    await saveCategory(USER, '식비')
    await saveCategory(USER, '식비')
    expect(await listCategories(USER)).toHaveLength(2)
  })
})
