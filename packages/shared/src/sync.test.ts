import { describe, expect, it } from 'vitest'
import {
  bookNotePayloadSchema, bookPayloadSchema, SCHEMA_VERSION, workoutPayloadSchema,
} from './sync.ts'

const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', status: 'READING', ...over,
})

describe('bookPayloadSchema', () => {
  it('제목과 상태만으로 통과하고 나머지는 null로 채운다', () => {
    const parsed = bookPayloadSchema.parse(book())
    expect(parsed).toEqual({
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null, genre: null,
    })
  })

  it('제목의 앞뒤 공백을 없애고 빈 제목은 거부한다', () => {
    expect(bookPayloadSchema.parse(book({ title: '  사피엔스  ' })).title)
      .toBe('사피엔스')
    expect(bookPayloadSchema.safeParse(book({ title: '   ' })).success).toBe(false)
  })

  it('코드값이 아닌 상태를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ status: 'reading' })).success).toBe(false)
    expect(bookPayloadSchema.safeParse(book({ status: '읽는중' })).success).toBe(false)
  })

  // DB의 books_period_ck를 여기서도 막는다. 통과시키면 INSERT가 DB 에러로
  // 죽고, 그 500은 REJECTED가 아니라 재시도 대상이라 큐가 영영 막힌다.
  it('완독일이 시작일보다 앞서면 거부한다', () => {
    const result = bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-10', finishedOn: '2026-08-09' }),
    )
    expect(result.success).toBe(false)
  })

  it('한쪽이 null이면 기간 검사를 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: null, finishedOn: '2026-08-09' }),
    ).success).toBe(true)
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: null }),
    ).success).toBe(true)
  })

  it('같은 날 시작하고 끝낸 것은 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: '2026-08-09' }),
    ).success).toBe(true)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ userId: 2 })).success).toBe(false)
  })

  it('장르를 생략하면 null로 채운다', () => {
    expect(bookPayloadSchema.parse(book()).genre).toBeNull()
  })

  it('장르 코드값을 그대로 받는다', () => {
    expect(bookPayloadSchema.parse(book({ genre: 'NOVEL' })).genre).toBe('NOVEL')
  })

  // 값 집합이 DB에 있으므로 여기서 enum으로 막을 수 없다. 서버가 codes와
  // 대조해 REJECTED로 돌려준다.
  it('모르는 코드값도 스키마 단계에서는 통과한다', () => {
    expect(bookPayloadSchema.safeParse(book({ genre: 'WHATEVER' })).success).toBe(true)
  })

  it('빈 문자열 장르는 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ genre: '' })).success).toBe(false)
  })
})

describe('SCHEMA_VERSION', () => {
  /**
   * 부위·강도가 닫힌 enum에서 공통코드로 바뀌었다. 값 집합이 런타임 데이터가
   * 되었으므로 구버전 클라이언트는 관리자가 새로 넣은 코드를 다룰 수 없다 —
   * 라벨 자리가 빈칸이 되고, 수정 폼의 <select>에 그 옵션이 없어 사용자가 다른
   * 값을 고르는 순간 그 코드가 지워진다. 코드를 추가하는 시점에 올리는 것은
   * 기억에 의존하므로, 여는 시점인 지금 올려 구버전을 먼저 걸러낸다.
   */
  it('부위·강도가 공통코드가 되었으므로 5다', () => {
    expect(SCHEMA_VERSION).toBe(5)
  })
})

describe('bookNotePayloadSchema', () => {
  const note = (over: Record<string, unknown> = {}) => ({
    occurredOn: '2026-08-11',
    bookClientUuid: '00000000-0000-4000-8000-000000000001',
    content: '3부가 인상 깊다', ...over,
  })

  it('세 필드를 모두 요구한다', () => {
    expect(bookNotePayloadSchema.safeParse(note()).success).toBe(true)
  })

  // 부모는 선택 항목이 아니다. null을 허용하면 서버가 book_id를 못 채우고,
  // NOT NULL 위반이 500으로 나와 큐가 막힌다.
  it('부모 책 UUID가 null이면 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookClientUuid: null })).success)
      .toBe(false)
  })

  it('빈 본문을 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ content: '   ' })).success).toBe(false)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookId: 3 })).success).toBe(false)
  })
})

describe('workoutPayloadSchema', () => {
  const base = { occurredOn: '2026-08-13', name: '벤치프레스' }

  it('근력은 세트를 받고 durationMin은 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'STRENGTH',
      sets: [{ reps: 10, weightKg: 60 }],
    })
    expect(parsed.durationMin).toBeNull()
    // 안 보낸 선택 필드는 default로 채워져야 한다. undefined로 남으면
    // toColumns가 그 컬럼을 통째로 빼먹어 수정이 반영되지 않는다.
    expect(parsed.bodyPart).toBeNull()
    expect(parsed.intensity).toBeNull()
    expect(parsed.memo).toBeNull()
  })

  it('맨몸 운동은 weightKg가 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'STRENGTH', sets: [{ reps: 12, weightKg: null }],
    })
    expect(parsed.sets).toEqual([{ reps: 12, weightKg: null }])
  })

  it('유산소는 지속 시간을 받고 sets는 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'CARDIO', name: '러닝', durationMin: 30, intensity: 'MID',
    })
    expect(parsed.sets).toBeNull()
    expect(parsed.durationMin).toBe(30)
  })

  // 여기서 안 걸리면 DB의 workouts_shape_ck 위반이 되고, 그 500은
  // REJECTED가 아니라 재시도 대상이라 그 항목이 큐에서 영원히 빠지지 않는다.
  it('근력에 durationMin을 실으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: [{ reps: 10, weightKg: 60 }], durationMin: 30,
    }).success).toBe(false)
  })

  it('유산소에 sets를 실으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 30, sets: [{ reps: 10, weightKg: 60 }],
    }).success).toBe(false)
  })

  it('유산소에 durationMin이 없으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({ ...base, kind: 'CARDIO' }).success).toBe(false)
  })

  it('근력에 sets가 없으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({ ...base, kind: 'STRENGTH' }).success).toBe(false)
  })

  it('세트가 0개거나 51개면 거부한다', () => {
    const set = { reps: 10, weightKg: 60 }
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: [],
    }).success).toBe(false)
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: Array.from({ length: 51 }, () => set),
    }).success).toBe(false)
  })

  it('지속 시간이 하루를 넘으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 1441,
    }).success).toBe(false)
  })

  it('종목명이 비면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, name: '   ', kind: 'CARDIO', durationMin: 30,
    }).success).toBe(false)
  })

  // 공통 컬럼이 클라이언트에서 넘어올 경로를 남기지 않는다.
  it('모르는 키는 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 30, userId: 9,
    }).success).toBe(false)
  })

  it('ETC는 세트도 시간도 없이 통과한다', () => {
    const parsed = workoutPayloadSchema.parse({ ...base, kind: 'ETC', name: '요가' })
    expect(parsed.sets).toBeNull()
    expect(parsed.durationMin).toBeNull()
  })
})
