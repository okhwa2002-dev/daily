import { describe, expect, it } from 'vitest'
import { formatMinorUnits, toMinorUnits } from './money.ts'

describe('toMinorUnits', () => {
  it('소수점 없는 금액을 최소 단위로 바꾼다', () => {
    expect(toMinorUnits('12000')).toBe(1200000n)
  })

  it('소수점 두 자리를 그대로 담는다', () => {
    expect(toMinorUnits('12.34')).toBe(1234n)
  })

  it('소수점 한 자리는 0을 채운다', () => {
    expect(toMinorUnits('12.3')).toBe(1230n)
  })

  it('세 자리 이상은 잘라낸다', () => {
    expect(toMinorUnits('12.349')).toBe(1234n)
  })

  it('0을 다룬다', () => {
    expect(toMinorUnits('0')).toBe(0n)
  })
})

describe('formatMinorUnits', () => {
  it('원 단위로 천단위 구분해 보여준다', () => {
    expect(formatMinorUnits(3200000n)).toBe('32,000원')
  })

  it('음수는 부호를 앞에 붙인다', () => {
    expect(formatMinorUnits(-3200000n)).toBe('-32,000원')
  })

  it('0은 부호 없이 보여준다', () => {
    expect(formatMinorUnits(0n)).toBe('0원')
  })
})
