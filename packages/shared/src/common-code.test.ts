import { describe, expect, it } from 'vitest'
import { CODE_GROUP } from './common-code.ts'

describe('공통코드 그룹', () => {
  it('그룹 코드는 대문자와 밑줄만 쓴다', () => {
    for (const group of Object.values(CODE_GROUP)) {
      expect(group).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('독서 장르 그룹을 갖는다', () => {
    expect(CODE_GROUP.BOOK_GENRE).toBe('BOOK_GENRE')
  })
})
