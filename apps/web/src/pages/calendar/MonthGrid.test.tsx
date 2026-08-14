import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MonthGrid from './MonthGrid.tsx'
import type { DayRecords, MonthRecords } from './repository.ts'

const empty: DayRecords = { expenses: [], workouts: [], bookNotes: [] }

const withRecords = (over: Partial<DayRecords>): DayRecords => ({
  ...empty, ...over,
})

function records(entries: Record<string, Partial<DayRecords>>): MonthRecords {
  return new Map(Object.entries(entries).map(([k, v]) => [k, withRecords(v)]))
}

const base = {
  month: '2026-08',
  today: '2026-08-14',
  selected: null,
  onSelect: () => {},
}

describe('월 격자', () => {
  it('그 달의 날짜를 모두 그린다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 1일/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^8월 31일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^9월/ })).not.toBeInTheDocument()
  })

  // 점은 색으로만 구분되므로 라벨이 정보를 문장으로 담아야 한다. 이게
  // 없으면 색각 이상·스크린리더 사용자에게 이 화면의 목적이 성립하지 않는다.
  it('기록이 있는 도메인을 라벨에 적는다', () => {
    render(<MonthGrid {...base} records={records({
      '2026-08-14': { expenses: [{} as never], workouts: [{} as never] },
    })} />)

    expect(screen.getByRole('button', { name: '8월 14일, 지출·운동 기록' }))
      .toBeInTheDocument()
  })

  it('기록이 없는 날은 없다고 적는다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: '8월 14일, 기록 없음' }))
      .toBeInTheDocument()
  })

  it('독서만 있는 날도 라벨에 담는다', () => {
    render(<MonthGrid {...base} records={records({
      '2026-08-03': { bookNotes: [{} as never] },
    })} />)

    expect(screen.getByRole('button', { name: '8월 3일, 독서 기록' }))
      .toBeInTheDocument()
  })

  it('기록이 있는 도메인 수만큼 점을 찍는다', () => {
    const { container } = render(<MonthGrid {...base} records={records({
      '2026-08-14': { expenses: [{} as never], bookNotes: [{} as never] },
    })} />)

    const cell = screen.getByRole('button', { name: /^8월 14일/ })
    expect(cell.querySelectorAll('[data-dot]')).toHaveLength(2)
    // 기록이 없는 날에는 점이 하나도 없다.
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(2)
  })

  it('오늘을 표시한다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 14일/ }))
      .toHaveAttribute('data-today', 'true')
  })

  it('선택한 날을 표시한다', () => {
    render(<MonthGrid {...base} selected="2026-08-03" records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 3일/ }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^8월 14일/ }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('날짜를 누르면 그 날짜를 넘긴다', async () => {
    const onSelect = vi.fn()
    render(<MonthGrid {...base} onSelect={onSelect} records={new Map()} />)

    await userEvent.click(screen.getByRole('button', { name: /^8월 3일/ }))

    expect(onSelect).toHaveBeenCalledWith('2026-08-03')
  })

  // 2026-08-01은 토요일이라 앞에 여섯 칸이 빈다. 빈칸이 버튼이면
  // 키보드 사용자가 누를 수 없는 칸을 여섯 번 지나야 한다.
  it('앞 빈칸은 버튼이 아니다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getAllByRole('button')).toHaveLength(31)
  })
})
