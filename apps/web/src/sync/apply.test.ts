import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncRow } from '@daily/shared'
import { db } from '../db/index.ts'
import { applyServerRows, recordServerId } from './apply.ts'

const USER = 1
const BOOK_UUID = 'aaaaaaaa-0000-4000-8000-000000000001'
const NOTE_UUID = 'bbbbbbbb-0000-4000-8000-000000000002'
const WORKOUT_UUID = 'cccccccc-0000-4000-8000-000000000003'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const bookRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'books', id: 10, clientUuid: BOOK_UUID, occurredOn: null,
  updatedAt: '2026-08-11 12:00:00.000', syncedAt: '2026-08-11 12:00:00.500',
  deletedAt: null,
  payload: {
    title: '사피엔스', author: '유발 하라리', summary: null,
    status: 'READING', startedOn: null, finishedOn: null, genre: 'TECH',
  },
  ...over,
})

const noteRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'book_notes', id: 20, clientUuid: NOTE_UUID, occurredOn: '2026-08-11',
  updatedAt: '2026-08-11 12:00:00.000', syncedAt: '2026-08-11 12:00:00.500',
  deletedAt: null,
  payload: { occurredOn: '2026-08-11', bookClientUuid: BOOK_UUID, content: '좋다' },
  ...over,
})

describe('applyServerRows — 독서', () => {
  it('서버에서 내려온 책을 로컬에 넣는다', async () => {
    await applyServerRows(USER, [bookRow()])

    const local = await db.books.get(BOOK_UUID)
    expect(local?.title).toBe('사피엔스')
    expect(local?.author).toBe('유발 하라리')
    expect(local?.status).toBe('READING')
    expect(local?.genre).toBe('TECH')
    expect(local?.serverId).toBe(10)
    expect(local?.userId).toBe(USER)
  })

  it('서버에서 내려온 감상평을 로컬에 넣는다', async () => {
    await applyServerRows(USER, [noteRow()])

    const local = await db.bookNotes.get(NOTE_UUID)
    expect(local?.content).toBe('좋다')
    expect(local?.bookClientUuid).toBe(BOOK_UUID)
    expect(local?.occurredOn).toBe('2026-08-11')
  })

  it('로컬이 더 최신이면 덮지 않고 serverId만 채운다', async () => {
    await db.books.put({
      clientUuid: BOOK_UUID, userId: USER, serverId: null,
      title: '내가 고친 제목', author: null, summary: null,
      status: 'DONE', startedOn: null, finishedOn: null, genre: null,
      updatedAt: '2026-08-11 13:00:00.000', deletedAt: null,
    })

    await applyServerRows(USER, [bookRow()])

    const local = await db.books.get(BOOK_UUID)
    expect(local?.title).toBe('내가 고친 제목')
    expect(local?.serverId).toBe(10)
  })
})

describe('recordServerId', () => {
  // 삼항 분기로 두면 books가 else로 떨어져 expenseCategories에 기록된다.
  // 책의 serverId가 null로 남고, serverId가 없으면 삭제가 툼스톤으로
  // 전파되지 않아 지운 책이 다른 기기에서 되살아난다.
  it('책의 serverId를 책 스토어에 기록한다', async () => {
    await db.books.put({
      clientUuid: BOOK_UUID, userId: USER, serverId: null,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null, genre: null,
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    await recordServerId('books', BOOK_UUID, 42)

    expect((await db.books.get(BOOK_UUID))?.serverId).toBe(42)
    expect(await db.expenseCategories.count()).toBe(0)
  })

  it('감상평의 serverId를 감상평 스토어에 기록한다', async () => {
    await db.bookNotes.put({
      clientUuid: NOTE_UUID, userId: USER, serverId: null,
      occurredOn: '2026-08-11', bookClientUuid: BOOK_UUID, content: '좋다',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    await recordServerId('book_notes', NOTE_UUID, 43)

    expect((await db.bookNotes.get(NOTE_UUID))?.serverId).toBe(43)
  })
})

const workoutRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'workouts', id: 30, clientUuid: WORKOUT_UUID, occurredOn: '2026-08-13',
  updatedAt: '2026-08-13 12:00:00.000', syncedAt: '2026-08-13 12:00:00.500',
  deletedAt: null,
  payload: {
    occurredOn: '2026-08-13', kind: 'STRENGTH', name: '벤치프레스',
    bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }],
    durationMin: null, intensity: 'MID', memo: null,
  },
  ...over,
})

describe('applyServerRows — 운동', () => {
  it('서버에서 내려온 운동을 세트까지 로컬에 넣는다', async () => {
    await applyServerRows(USER, [workoutRow()])

    const local = await db.workouts.get(WORKOUT_UUID)
    expect(local?.name).toBe('벤치프레스')
    expect(local?.kind).toBe('STRENGTH')
    expect(local?.bodyPart).toBe('CHEST')
    expect(local?.intensity).toBe('MID')
    // APPLIERS에서 sets 줄이 통째로 빠져도 나머지 단언은 전부 통과한다.
    expect(local?.sets).toEqual([{ reps: 10, weightKg: 60 }])
    expect(local?.serverId).toBe(30)
  })

  it('유산소는 durationMin이 채워지고 sets는 null이다', async () => {
    await applyServerRows(USER, [workoutRow({
      payload: {
        occurredOn: '2026-08-13', kind: 'CARDIO', name: '러닝', bodyPart: null,
        sets: null, durationMin: 30, intensity: null, memo: null,
      },
    })])

    const local = await db.workouts.get(WORKOUT_UUID)
    expect(local?.durationMin).toBe(30)
    expect(local?.sets).toBeNull()
  })
})

describe('recordServerId — 운동', () => {
  it('운동의 serverId를 운동 스토어에 기록한다', async () => {
    await db.workouts.put({
      clientUuid: WORKOUT_UUID, userId: USER, serverId: null,
      occurredOn: '2026-08-13', kind: 'CARDIO', name: '러닝', bodyPart: null,
      sets: null, durationMin: 30, intensity: null, memo: null,
      updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
    })

    await recordServerId('workouts', WORKOUT_UUID, 44)

    expect((await db.workouts.get(WORKOUT_UUID))?.serverId).toBe(44)
  })
})
