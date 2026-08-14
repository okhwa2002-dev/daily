import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import {
  bookNotes, books, expenseCategories, expenses, journals, meals, users, workouts,
} from './schema.ts'
import { dbNow } from './time.ts'
import { resetDb, testLoginId } from './testing.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

const NOW = () => dbNow()
const TODAY = '2026-08-10'

async function makeUser(email = 'owner@example.com'): Promise<number> {
  const now = NOW()
  const [row] = await db.insert(users).values({
    loginId: testLoginId(email), email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

/** 도메인 테이블이 공통으로 요구하는 컬럼 묶음. */
function common(userId: number, clientUuid: string) {
  const now = NOW()
  return {
    clientUuid, userId, syncedAt: now,
    createdAt: now, createdBy: userId, updatedAt: now, updatedBy: userId,
  }
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('expenses', () => {
  it('지출을 저장하고 카테고리와 함께 조회한다', async () => {
    const userId = await makeUser()
    const [cat] = await db.insert(expenseCategories)
      .values({ ...common(userId, UUID(1)), name: '식비' }).returning()

    const [row] = await db.insert(expenses).values({
      ...common(userId, UUID(2)),
      occurredOn: TODAY, kind: 'EXPENSE', amount: '12000.00',
      categoryId: cat!.id, categoryClientUuid: UUID(1), memo: '점심 김밥',
    }).returning()

    // 금액은 문자열로 왕복해야 한다. 부동소수점을 거치면 12000.00이 깨진다.
    expect(row?.amount).toBe('12000.00')
    expect(row?.occurredOn).toBe(TODAY)
    expect(row?.categoryId).toBe(cat!.id)
  })

  it('정해진 코드값이 아닌 kind는 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(expenses).values({
      ...common(userId, UUID(3)),
      occurredOn: TODAY, kind: 'SPEND', amount: '1000',
    })).rejects.toThrow()
  })

  it('음수 금액은 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(expenses).values({
      ...common(userId, UUID(4)),
      occurredOn: TODAY, kind: 'EXPENSE', amount: '-1000',
    })).rejects.toThrow()
  })

  it('같은 사용자의 같은 client_uuid는 중복될 수 없다', async () => {
    const userId = await makeUser()
    const values = {
      ...common(userId, UUID(5)),
      occurredOn: TODAY, kind: 'EXPENSE' as const, amount: '1000',
    }
    await db.insert(expenses).values(values)
    await expect(db.insert(expenses).values(values)).rejects.toThrow()
  })

  it('사용자가 다르면 같은 client_uuid를 써도 된다', async () => {
    const a = await makeUser('a@example.com')
    const b = await makeUser('b@example.com')
    await db.insert(expenses).values({
      ...common(a, UUID(6)), occurredOn: TODAY, kind: 'EXPENSE', amount: '1000',
    })
    await db.insert(expenses).values({
      ...common(b, UUID(6)), occurredOn: TODAY, kind: 'EXPENSE', amount: '2000',
    })
    expect(await db.select().from(expenses)).toHaveLength(2)
  })
})

describe('workouts', () => {
  it('근력 운동의 세트를 JSONB로 저장하고 그대로 돌려받는다', async () => {
    const userId = await makeUser()
    const [row] = await db.insert(workouts).values({
      ...common(userId, UUID(10)),
      occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
      bodyPart: 'CHEST', intensity: 'HIGH',
      sets: [{ reps: 10, weightKg: 60 }, { reps: 8, weightKg: 65 }],
    }).returning()

    expect(row?.sets).toEqual([{ reps: 10, weightKg: 60 }, { reps: 8, weightKg: 65 }])
  })

  it('유산소는 시간을 저장한다', async () => {
    const userId = await makeUser()
    const [row] = await db.insert(workouts).values({
      ...common(userId, UUID(11)),
      occurredOn: TODAY, kind: 'CARDIO', name: '러닝', durationMin: 30,
    }).returning()
    expect(row?.durationMin).toBe(30)
  })

  it('STRENGTH인데 세트가 없으면 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(workouts).values({
      ...common(userId, UUID(12)),
      occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
    })).rejects.toThrow()
  })

  it('CARDIO인데 시간이 없으면 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(workouts).values({
      ...common(userId, UUID(13)),
      occurredOn: TODAY, kind: 'CARDIO', name: '러닝',
    })).rejects.toThrow()
  })

  /**
   * 부위·강도에는 CHECK가 없다 — 값 집합이 `codes` 테이블에 있는 런타임
   * 데이터라 CHECK로 표현할 수 없기 때문이다. 관리자가 코드를 넣으면 배포
   * 없이 바로 쓸 수 있어야 하는데, CHECK가 남아 있으면 그 INSERT가 500이 되고
   * 500은 재시도 대상이라 큐가 영원히 막힌다.
   *
   * 방어는 서버의 sync 검증으로 옮겼다 (`sync/registry.ts`의 `workouts.validate`).
   * 모르는 코드가 REJECTED로 돌아가는 것은 `routes/sync.test.ts`가 지킨다.
   */
  it('body_part는 DB가 막지 않는다 — 검증은 sync 계층이 한다', async () => {
    const userId = await makeUser()
    const [row] = await db.insert(workouts).values({
      ...common(userId, UUID(14)),
      occurredOn: TODAY, kind: 'ETC', name: '스트레칭', bodyPart: 'NECK',
    }).returning()
    expect(row?.bodyPart).toBe('NECK')
  })
})

describe('meals', () => {
  it('식사를 저장한다', async () => {
    const userId = await makeUser()
    const [row] = await db.insert(meals).values({
      ...common(userId, UUID(20)),
      occurredOn: TODAY, slot: 'LUNCH', description: '김밥', portion: 'NORMAL', calories: 500,
    }).returning()
    expect(row?.slot).toBe('LUNCH')
    expect(row?.calories).toBe(500)
  })

  it('정해진 코드값이 아닌 portion은 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(meals).values({
      ...common(userId, UUID(21)),
      occurredOn: TODAY, slot: 'LUNCH', description: '김밥', portion: 'LOTS',
    })).rejects.toThrow()
  })
})

describe('journals', () => {
  it('하루에 두 건을 쓸 수 없다', async () => {
    const userId = await makeUser()
    await db.insert(journals).values({
      ...common(userId, UUID(30)), occurredOn: TODAY, content: '첫 글',
    })
    await expect(db.insert(journals).values({
      ...common(userId, UUID(31)), occurredOn: TODAY, content: '둘째 글',
    })).rejects.toThrow()
  })

  it('삭제된 일기가 있으면 같은 날 다시 쓸 수 있다', async () => {
    const userId = await makeUser()
    const now = NOW()
    await db.insert(journals).values({
      ...common(userId, UUID(32)), occurredOn: TODAY, content: '지울 글',
      deletedAt: now, deletedBy: userId,
    })
    // 툼스톤은 남지만 부분 유니크 인덱스에는 걸리지 않아야 한다.
    await db.insert(journals).values({
      ...common(userId, UUID(33)), occurredOn: TODAY, content: '다시 쓴 글',
    })

    const live = await db.select().from(journals)
      .where(and(eq(journals.userId, userId), isNull(journals.deletedAt)))
    expect(live).toHaveLength(1)
    expect(live[0]?.content).toBe('다시 쓴 글')
  })

  it('다른 사용자는 같은 날 각자 쓸 수 있다', async () => {
    const a = await makeUser('a@example.com')
    const b = await makeUser('b@example.com')
    await db.insert(journals).values({ ...common(a, UUID(34)), occurredOn: TODAY, content: 'A' })
    await db.insert(journals).values({ ...common(b, UUID(35)), occurredOn: TODAY, content: 'B' })
    expect(await db.select().from(journals)).toHaveLength(2)
  })
})

describe('books · book_notes', () => {
  it('책과 감상평 여러 건을 저장한다', async () => {
    const userId = await makeUser()
    const [book] = await db.insert(books).values({
      ...common(userId, UUID(40)),
      title: '실용주의 프로그래머', author: 'Hunt', status: 'READING', startedOn: '2026-08-01',
    }).returning()

    for (const n of [41, 42]) {
      await db.insert(bookNotes).values({
        ...common(userId, UUID(n)),
        occurredOn: TODAY, bookId: book!.id, bookClientUuid: UUID(40),
        content: `감상 ${n}`,
      })
    }

    const notes = await db.select().from(bookNotes).where(eq(bookNotes.bookId, book!.id))
    expect(notes).toHaveLength(2)
  })

  it('없는 책을 가리키는 감상평은 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(bookNotes).values({
      ...common(userId, UUID(43)),
      occurredOn: TODAY, bookId: 999999, bookClientUuid: UUID(99), content: '유령 감상',
    })).rejects.toThrow()
  })

  it('완독일이 시작일보다 빠르면 거부한다', async () => {
    const userId = await makeUser()
    await expect(db.insert(books).values({
      ...common(userId, UUID(44)),
      title: '거꾸로', status: 'DONE', startedOn: '2026-08-05', finishedOn: '2026-08-01',
    })).rejects.toThrow()
  })
})

describe('공통 컬럼', () => {
  it('시각 컬럼은 KST 벽시계 문자열로, 날짜 컬럼은 타임존 없이 왕복한다', async () => {
    const userId = await makeUser()
    const [row] = await db.insert(meals).values({
      ...common(userId, UUID(50)),
      occurredOn: TODAY, slot: 'DINNER', description: '된장찌개', portion: 'HEAVY',
    }).returning()

    expect(row?.occurredOn).toBe(TODAY)
    expect(row?.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(row?.syncedAt).not.toContain('Z')
    expect(row?.syncedAt).not.toContain('+')
  })

  it('deleted_at 없이 조회하면 툼스톤이 섞여 나온다 — 조회 쿼리는 항상 걸러야 한다', async () => {
    const userId = await makeUser()
    const now = NOW()
    await db.insert(meals).values({
      ...common(userId, UUID(51)), occurredOn: TODAY, slot: 'LUNCH',
      description: '살아있는 기록', portion: 'NORMAL',
    })
    await db.insert(meals).values({
      ...common(userId, UUID(52)), occurredOn: TODAY, slot: 'LUNCH',
      description: '지운 기록', portion: 'NORMAL', deletedAt: now, deletedBy: userId,
    })

    expect(await db.select().from(meals)).toHaveLength(2)
    const live = await db.select().from(meals)
      .where(and(eq(meals.userId, userId), isNull(meals.deletedAt)))
    expect(live).toHaveLength(1)
  })
})
