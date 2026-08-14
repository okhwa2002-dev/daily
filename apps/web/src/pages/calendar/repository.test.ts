import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { listCategoryNames, loadMonth } from './repository.ts'

const USER = 1
const OTHER = 2

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.bookNotes.clear()
  await db.expenseCategories.clear()
})

const expense = (over: Record<string, unknown> = {}) => db.expenses.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const workout = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', kind: 'STRENGTH', name: '벤치프레스',
  bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }], durationMin: null,
  intensity: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const note = (over: Record<string, unknown> = {}) => db.bookNotes.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', bookClientUuid: 'book-1', content: '3부까지 읽음',
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

describe('loadMonth', () => {
  it('세 도메인을 날짜별로 모은다', async () => {
    await expense()
    await workout()
    await note()

    const records = await loadMonth(USER, '2026-08')

    const day = records.get('2026-08-14')
    expect(day?.expenses).toHaveLength(1)
    expect(day?.workouts).toHaveLength(1)
    expect(day?.bookNotes).toHaveLength(1)
  })

  it('기록이 없는 날은 키 자체가 없다', async () => {
    await expense()

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-13')).toBe(false)
    expect(records.get('2026-08-13')).toBeUndefined()
  })

  it('기록이 하나도 없으면 빈 Map이다', async () => {
    const records = await loadMonth(USER, '2026-08')
    expect(records.size).toBe(0)
  })

  it('툼스톤을 제외한다', async () => {
    await expense({ memo: '살아있음' })
    await expense({ memo: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.get('2026-08-14')?.expenses).toHaveLength(1)
    expect(records.get('2026-08-14')?.expenses[0]?.memo).toBe('살아있음')
  })

  // 세 도메인이 모두 툼스톤뿐이면 그 날짜 키를 만들면 안 된다. 만들면
  // 격자에 점이 없는데도 "기록 있음"으로 잡혀 aria-label이 거짓말을 한다.
  it('툼스톤만 있는 날은 키를 만들지 않는다', async () => {
    await expense({ deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-14')).toBe(false)
  })

  it('다른 사용자의 기록을 섞지 않는다', async () => {
    await expense({ userId: OTHER, memo: '남의 것' })
    await expense({ memo: '내 것' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.get('2026-08-14')?.expenses).toHaveLength(1)
    expect(records.get('2026-08-14')?.expenses[0]?.memo).toBe('내 것')
  })

  it('그 달의 1일과 말일을 포함한다', async () => {
    await expense({ occurredOn: '2026-08-01' })
    await expense({ occurredOn: '2026-08-31' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-01')).toBe(true)
    expect(records.has('2026-08-31')).toBe(true)
  })

  it('인접한 달을 포함하지 않는다', async () => {
    await expense({ occurredOn: '2026-07-31' })
    await expense({ occurredOn: '2026-09-01' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.size).toBe(0)
  })

  // 상한을 '-31'로 고정하는 방식이 짧은 달에서도 성립하는지 본다.
  it('2월 말일도 잡는다', async () => {
    await expense({ occurredOn: '2026-02-28' })

    const records = await loadMonth(USER, '2026-02')

    expect(records.has('2026-02-28')).toBe(true)
  })
})

describe('listCategoryNames', () => {
  it('clientUuid로 이름을 찾을 수 있게 돌려준다', async () => {
    await db.expenseCategories.put({
      clientUuid: 'cat-1', userId: USER, serverId: null, name: '식비',
      updatedAt: '2026-08-14 12:00:00.000', deletedAt: null,
    } as never)

    const names = await listCategoryNames(USER)

    expect(names.get('cat-1')).toBe('식비')
  })

  it('삭제된 카테고리는 빼고 다른 사용자 것도 뺀다', async () => {
    await db.expenseCategories.bulkPut([
      { clientUuid: 'cat-1', userId: USER, serverId: null, name: '지워짐',
        updatedAt: '2026-08-14 12:00:00.000', deletedAt: '2026-08-14 13:00:00.000' },
      { clientUuid: 'cat-2', userId: OTHER, serverId: null, name: '남의 것',
        updatedAt: '2026-08-14 12:00:00.000', deletedAt: null },
    ] as never)

    const names = await listCategoryNames(USER)

    expect(names.size).toBe(0)
  })
})
