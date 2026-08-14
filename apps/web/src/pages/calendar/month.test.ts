import { describe, expect, it } from 'vitest'
import { addMonths, monthGrid, monthLabel, monthOf } from './month.ts'

describe('monthGrid', () => {
  // 2026-08-01은 토요일이다. 일요일 시작 격자라 앞에 여섯 칸이 빈다.
  it('1일이 토요일인 달은 앞을 여섯 칸 비운다', () => {
    const grid = monthGrid('2026-08')
    expect(grid.leadingBlanks).toBe(6)
    expect(grid.days).toHaveLength(31)
    expect(grid.days[0]).toBe('2026-08-01')
    expect(grid.days[30]).toBe('2026-08-31')
  })

  // 2026-02-01은 일요일이다. 빈칸이 없는 경계 케이스다.
  it('1일이 일요일인 달은 앞을 비우지 않는다', () => {
    const grid = monthGrid('2026-02')
    expect(grid.leadingBlanks).toBe(0)
    expect(grid.days).toHaveLength(28)
  })

  it('윤년 2월은 29일이다', () => {
    const grid = monthGrid('2024-02')
    expect(grid.leadingBlanks).toBe(4)   // 2024-02-01은 목요일
    expect(grid.days).toHaveLength(29)
    expect(grid.days[28]).toBe('2024-02-29')
  })

  it('30일 달을 30일로 센다', () => {
    const grid = monthGrid('2026-09')
    expect(grid.leadingBlanks).toBe(2)   // 2026-09-01은 화요일
    expect(grid.days).toHaveLength(30)
    expect(grid.days[29]).toBe('2026-09-30')
  })

  it('날짜를 두 자리로 채운다', () => {
    expect(monthGrid('2026-08').days[8]).toBe('2026-08-09')
  })
})

describe('addMonths', () => {
  it('다음 달로 넘어간다', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09')
  })

  it('이전 달로 넘어간다', () => {
    expect(addMonths('2026-08', -1)).toBe('2026-07')
  })

  it('연말을 넘어간다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })

  it('연초에서 뒤로 넘어간다', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})

describe('monthOf', () => {
  it('날짜에서 월을 떼어낸다', () => {
    expect(monthOf('2026-08-14')).toBe('2026-08')
  })
})

describe('monthLabel', () => {
  it('한국어 라벨로 바꾼다', () => {
    expect(monthLabel('2026-08')).toBe('2026년 8월')
  })

  it('앞자리 0을 떼고 보여준다', () => {
    expect(monthLabel('2026-01')).toBe('2026년 1월')
  })
})
