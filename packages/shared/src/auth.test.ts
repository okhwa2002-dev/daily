import { describe, expect, it } from 'vitest'
import { NORMALIZED_LOGIN_ID, loginIdSchema, loginSchema, registerSchema } from './auth.ts'

describe('loginIdSchema', () => {
  it('소문자로 정규화한다', () => {
    // 'Kim'과 'kim'이 서로 다른 계정이 되면 로그인 실패와 사칭 혼동이 생긴다.
    expect(loginIdSchema.parse('MixedCase')).toBe('mixedcase')
    expect(loginIdSchema.parse('USER_01')).toBe('user_01')
  })

  it('앞뒤 공백을 제거한다', () => {
    expect(loginIdSchema.parse('  testuser  ')).toBe('testuser')
  })

  it.each([
    ['최소 길이', 'abcd'],
    ['최대 길이', 'a'.repeat(20)],
    ['숫자 포함', 'user123'],
    ['밑줄 포함', 'my_id_01'],
    ['숫자로만', '12345'],
  ])('규칙에 맞는 아이디는 통과한다 — %s', (_label, value) => {
    expect(() => loginIdSchema.parse(value)).not.toThrow()
  })

  it.each([
    ['3자', 'abc'],
    ['21자', 'a'.repeat(21)],
    ['하이픈', 'user-name'],
    ['점', 'user.name'],
    ['골뱅이', 'user@name'],
    ['한글', '사용자아이디'],
    ['공백 포함', 'user name'],
    ['빈 문자열', ''],
  ])('규칙에 맞지 않으면 거부한다 — %s', (_label, value) => {
    expect(() => loginIdSchema.parse(value)).toThrow()
  })

  it('정규화 결과는 항상 DB 제약과 같은 모양이다', () => {
    // 이 둘이 어긋나면 애플리케이션은 통과시킨 값이 DB에서 거부된다.
    for (const input of ['ABCD', 'User_01', '  MyName  ', 'A'.repeat(20)]) {
      expect(loginIdSchema.parse(input)).toMatch(NORMALIZED_LOGIN_ID)
    }
  })
})

describe('registerSchema', () => {
  const valid = { loginId: 'testuser', email: 'User@Example.com', password: '충분히 긴 비밀번호' }

  it('아이디와 이메일을 모두 소문자로 정규화한다', () => {
    const parsed = registerSchema.parse({ ...valid, loginId: 'TestUser' })
    expect(parsed.loginId).toBe('testuser')
    expect(parsed.email).toBe('user@example.com')
  })

  it('이메일 없이는 통과하지 않는다', () => {
    // 비밀번호를 잊었을 때 계정을 되찾을 유일한 수단이라 필수다.
    expect(() => registerSchema.parse({ loginId: 'testuser', password: valid.password }))
      .toThrow()
  })

  it('짧은 비밀번호를 거부한다', () => {
    expect(() => registerSchema.parse({ ...valid, password: 'short' })).toThrow()
  })
})

describe('loginSchema', () => {
  it('아이디와 비밀번호만 받는다', () => {
    const parsed = loginSchema.parse({ loginId: 'TestUser', password: 'x' })
    expect(parsed).toEqual({ loginId: 'testuser', password: 'x' })
  })

  it('이메일로는 로그인할 수 없다', () => {
    expect(() => loginSchema.parse({ email: 'user@example.com', password: 'x' })).toThrow()
  })
})
