import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { LocalBookNote, LocalExpense, LocalWorkout } from '../../db/index.ts'
import DaySummary from './DaySummary.tsx'
import type { DayRecords } from './repository.ts'

const DATE = '2026-08-14'

const expense = (over: Partial<LocalExpense> = {}): LocalExpense => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const workout = (over: Partial<LocalWorkout> = {}): LocalWorkout => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const note = (over: Partial<LocalBookNote> = {}): LocalBookNote => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, bookClientUuid: 'book-1', content: '3부까지 읽음',
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const day = (over: Partial<DayRecords> = {}): DayRecords => ({
  expenses: [], workouts: [], bookNotes: [], ...over,
})

const base = {
  date: DATE,
  categoryNames: new Map([['cat-1', '식비']]),
  bodyParts: [{ groupCode: 'BODY_PART', code: 'CHEST', name: '가슴', sortOrder: 1 }],
  intensities: [{ groupCode: 'INTENSITY', code: 'MID', name: '보통', sortOrder: 2 }],
}

const draw = (records: DayRecords | undefined) => render(
  <MemoryRouter><DaySummary {...base} records={records} /></MemoryRouter>,
)

describe('하루 요약', () => {
  it('기록이 없으면 없다고 알린다', () => {
    draw(undefined)
    expect(screen.getByText('이 날은 기록이 없습니다.')).toBeInTheDocument()
  })

  it('모든 도메인이 비어도 없다고 알린다', () => {
    draw(day())
    expect(screen.getByText('이 날은 기록이 없습니다.')).toBeInTheDocument()
  })

  it('지출 합계를 수입과 상계해 보여준다', () => {
    draw(day({ expenses: [
      expense({ amount: '12000' }),
      expense({ amount: '20000' }),
      expense({ amount: '5000', kind: 'INCOME' }),
    ] }))

    expect(screen.getByText('-27,000원')).toBeInTheDocument()
  })

  it('카테고리 이름을 붙인다', () => {
    draw(day({ expenses: [expense({ categoryClientUuid: 'cat-1', memo: '김밥' })] }))

    expect(screen.getByText('식비')).toBeInTheDocument()
    expect(screen.getByText('김밥')).toBeInTheDocument()
  })

  // ExpenseForm은 카테고리 select를 ''(→ null)로 초기화하므로, 손대지 않고
  // 저장한 지출은 categoryClientUuid가 null이다. ExpensePage와 같은 표기여야 한다.
  it('카테고리가 없으면 미분류로 표시한다', () => {
    draw(day({ expenses: [expense({ categoryClientUuid: null })] }))
    expect(screen.getByText('미분류')).toBeInTheDocument()
  })

  // 카테고리가 삭제되면 listCategoryNames의 결과(categoryNames)에서 빠진다.
  // 기록 자체는 남아있으므로 빈칸이 아니라 미분류로 보여야 한다.
  it('카테고리가 삭제됐으면 미분류로 표시한다', () => {
    draw(day({ expenses: [expense({ categoryClientUuid: 'cat-deleted' })] }))
    expect(screen.getByText('미분류')).toBeInTheDocument()
  })

  it('근력은 세트를 줄여 보여준다', () => {
    draw(day({ workouts: [workout({
      sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }],
    }) ] }))

    expect(screen.getByText('60kg×10, ×12')).toBeInTheDocument()
  })

  it('부위 라벨을 코드 캐시에서 찾는다', () => {
    draw(day({ workouts: [workout({ bodyPart: 'CHEST' })] }))
    expect(screen.getByText('가슴')).toBeInTheDocument()
  })

  it('유산소는 시간과 강도를 보여준다', () => {
    draw(day({ workouts: [workout({
      kind: 'CARDIO', name: '러닝', sets: null, durationMin: 30, intensity: 'MID',
    })] }))

    expect(screen.getByText('30분 · 보통')).toBeInTheDocument()
  })

  // apply.ts가 서버 페이로드를 재검증 없이 Dexie에 쓴다. 세트가 없는
  // 근력 기록이 내려와도 화면이 깨지면 안 된다.
  it('세트가 없는 근력 기록에도 깨지지 않는다', () => {
    draw(day({ workouts: [workout({ sets: null })] }))
    expect(screen.getByText('벤치프레스')).toBeInTheDocument()
  })

  it('감상평 내용을 보여준다', () => {
    draw(day({ bookNotes: [note({ content: '3부까지 읽음' })] }))
    expect(screen.getByText('3부까지 읽음')).toBeInTheDocument()
  })

  it('비어 있는 도메인의 섹션은 그리지 않는다', () => {
    draw(day({ expenses: [expense()] }))

    expect(screen.getByRole('heading', { name: '지출' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '운동' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '독서' })).not.toBeInTheDocument()
  })

  it('지출·운동 링크는 보던 날짜를 들고 간다', () => {
    draw(day({ expenses: [expense()], workouts: [workout()] }))

    expect(screen.getByRole('link', { name: '지출 자세히 보기' }))
      .toHaveAttribute('href', '/expenses?date=2026-08-14')
    expect(screen.getByRole('link', { name: '운동 자세히 보기' }))
      .toHaveAttribute('href', '/workouts?date=2026-08-14')
  })

  // 독서는 날짜별 화면이 아니라 책 목록이다. date를 받아도 쓸 자리가 없다.
  it('독서 링크는 날짜를 넘기지 않는다', () => {
    draw(day({ bookNotes: [note()] }))

    expect(screen.getByRole('link', { name: '독서 자세히 보기' }))
      .toHaveAttribute('href', '/books')
  })
})
