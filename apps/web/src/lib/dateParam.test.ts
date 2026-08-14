import { describe, expect, it } from 'vitest'
import { kstDate } from '@daily/shared'
import { dateParam } from './dateParam.ts'

const TODAY = kstDate(new Date())

describe('dateParam', () => {
  it('올바른 날짜를 그대로 쓴다', () => {
    expect(dateParam('2026-08-14')).toBe('2026-08-14')
  })

  it('없으면 오늘이다', () => {
    expect(dateParam(null)).toBe(TODAY)
  })

  it('형식이 어긋나면 오늘이다', () => {
    expect(dateParam('2026/08/14')).toBe(TODAY)
    expect(dateParam('오늘')).toBe(TODAY)
    expect(dateParam('')).toBe(TODAY)
  })

  // 형식만 보면 통과하지만 존재하지 않는 날짜다. <input type="date">에
  // 넣으면 빈칸으로 렌더되어 사용자가 날짜를 잃은 것처럼 보인다.
  it('없는 날짜면 오늘이다', () => {
    expect(dateParam('2026-13-01')).toBe(TODAY)
    expect(dateParam('2026-02-30')).toBe(TODAY)
    expect(dateParam('2026-00-10')).toBe(TODAY)
  })

  it('윤년 2월 29일은 통과시킨다', () => {
    expect(dateParam('2024-02-29')).toBe('2024-02-29')
  })
})
