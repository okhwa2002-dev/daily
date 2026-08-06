import { describe, expect, it } from 'vitest'
import { fromKstTimestamp, kstDate, toKstTimestamp } from './datetime.ts'

describe('KST 변환', () => {
  it('UTC 시각을 KST 벽시계 문자열로 바꾼다', () => {
    // 2026-08-05T15:00:00Z = 2026-08-06 00:00 KST
    expect(toKstTimestamp(new Date('2026-08-05T15:00:00.000Z')))
      .toBe('2026-08-06 00:00:00.000')
  })

  it('KST 문자열을 Date로 되돌린다', () => {
    expect(fromKstTimestamp('2026-08-06 00:00:00.000').toISOString())
      .toBe('2026-08-05T15:00:00.000Z')
  })

  it('왕복 변환이 원본과 같다', () => {
    const original = new Date('2026-02-28T23:45:12.345Z')
    expect(fromKstTimestamp(toKstTimestamp(original)).getTime())
      .toBe(original.getTime())
  })

  it('날짜 경계에서 KST 기준 날짜를 반환한다', () => {
    // UTC로는 8월 5일이지만 KST로는 8월 6일
    expect(kstDate(new Date('2026-08-05T15:30:00.000Z'))).toBe('2026-08-06')
    // UTC로는 8월 6일이지만 KST로는 아직 8월 6일 08:59
    expect(kstDate(new Date('2026-08-05T23:59:00.000Z'))).toBe('2026-08-06')
  })
})
