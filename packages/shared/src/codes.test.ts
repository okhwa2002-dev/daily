import { describe, expect, it } from 'vitest'
import { ALL_CODES, EXPENSE_KIND, MEAL_SLOT, USER_STATUS } from './codes.ts'

describe('코드성 데이터', () => {
  it('모든 코드값은 대문자와 밑줄만 사용한다', () => {
    expect(ALL_CODES.length).toBeGreaterThan(0)
    for (const code of ALL_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('코드값에 중복이 없다', () => {
    for (const group of [EXPENSE_KIND, MEAL_SLOT, USER_STATUS]) {
      expect(new Set(group).size).toBe(group.length)
    }
  })

  it('지출 구분은 INCOME과 EXPENSE 두 가지다', () => {
    expect(EXPENSE_KIND).toEqual(['INCOME', 'EXPENSE'])
  })
})
