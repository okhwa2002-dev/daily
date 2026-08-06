import { describe, expect, it } from 'vitest'
import { assertValidPassword, hashPassword, verifyPassword } from './password.ts'
import { AppError } from '../errors.ts'

describe('비밀번호 정책', () => {
  it('10자 미만은 거부한다', () => {
    expect(() => assertValidPassword('short123')).toThrow(AppError)
  })

  it('128자 초과는 거부한다', () => {
    expect(() => assertValidPassword('a'.repeat(129))).toThrow(AppError)
  })

  it('흔한 비밀번호는 거부한다', () => {
    expect(() => assertValidPassword('password123')).toThrow(AppError)
    expect(() => assertValidPassword('qwerty123456')).toThrow(AppError)
  })

  it('대소문자를 구분하지 않고 블랙리스트를 적용한다', () => {
    expect(() => assertValidPassword('Password123')).toThrow(AppError)
  })

  it('특수문자를 요구하지 않는다', () => {
    expect(() => assertValidPassword('여름밤의 산책 기록')).not.toThrow()
  })
})

describe('해싱', () => {
  it('해시는 원문을 포함하지 않는다', async () => {
    const hash = await hashPassword('나의 긴 비밀번호 문장')
    expect(hash).not.toContain('나의 긴 비밀번호 문장')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('같은 비밀번호도 매번 다른 해시가 나온다', async () => {
    const a = await hashPassword('나의 긴 비밀번호 문장')
    const b = await hashPassword('나의 긴 비밀번호 문장')
    expect(a).not.toBe(b)
  })

  it('올바른 비밀번호만 검증에 통과한다', async () => {
    const hash = await hashPassword('나의 긴 비밀번호 문장')
    expect(await verifyPassword(hash, '나의 긴 비밀번호 문장')).toBe(true)
    expect(await verifyPassword(hash, '틀린 비밀번호 문장입니다')).toBe(false)
  })
})
