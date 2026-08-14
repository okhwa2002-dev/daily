import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { loadToday } from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-14'

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.books.clear()
})

const expense = (over: Record<string, unknown> = {}) => db.expenses.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: TODAY, kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const workout = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
  bodyPart: null, sets: [{ reps: 10, weightKg: 60 }], durationMin: null,
  intensity: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const book = (over: Record<string, unknown> = {}) => db.books.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  title: '클린 코드', author: null, summary: null, status: 'READING',
  startedOn: null, finishedOn: null, genre: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

describe('loadToday', () => {
  it('오늘의 지출·운동과 읽는 중인 책을 함께 돌려준다', async () => {
    await expense()
    await workout()
    await book()

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(1)
    expect(records.workouts).toHaveLength(1)
    expect(records.readingBooks).toHaveLength(1)
  })

  it('기록이 하나도 없으면 빈 배열 셋이다', async () => {
    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toEqual([])
    expect(records.workouts).toEqual([])
    expect(records.readingBooks).toEqual([])
  })

  it('다른 날짜의 지출·운동을 섞지 않는다', async () => {
    await expense({ occurredOn: '2026-08-13', memo: '어제' })
    await expense({ occurredOn: '2026-08-15', memo: '내일' })
    await workout({ occurredOn: '2026-08-13', name: '어제운동' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(0)
    expect(records.workouts).toHaveLength(0)
  })

  // 독서 카드는 날짜 축이 아니다. 오늘 감상평을 안 썼다고 읽는 중인 책이
  // 사라지면 카드가 빈 것으로 보인다.
  it('읽는 중인 책은 날짜와 무관하게 잡는다', async () => {
    await book({ title: '오래된 책', updatedAt: '2020-01-01 00:00:00.000' })

    const records = await loadToday(USER, TODAY)

    expect(records.readingBooks).toHaveLength(1)
    expect(records.readingBooks[0]?.title).toBe('오래된 책')
  })

  it('READING이 아닌 책은 뺀다', async () => {
    await book({ title: '읽는 중', status: 'READING' })
    await book({ title: '다 읽음', status: 'DONE' })
    await book({ title: '읽고 싶음', status: 'WISHLIST' })

    const records = await loadToday(USER, TODAY)

    expect(records.readingBooks).toHaveLength(1)
    expect(records.readingBooks[0]?.title).toBe('읽는 중')
  })

  it('툼스톤을 제외한다', async () => {
    await expense({ memo: '살아있음' })
    await expense({ memo: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })
    await workout({ name: '살아있음', })
    await workout({ name: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })
    await book({ title: '살아있음' })
    await book({ title: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(1)
    expect(records.workouts).toHaveLength(1)
    expect(records.readingBooks).toHaveLength(1)
  })

  it('다른 사용자의 기록을 섞지 않는다', async () => {
    await expense({ userId: OTHER, memo: '남의 것' })
    await workout({ userId: OTHER, name: '남의 운동' })
    await book({ userId: OTHER, title: '남의 책' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(0)
    expect(records.workouts).toHaveLength(0)
    expect(records.readingBooks).toHaveLength(0)
  })
})
