import argon2 from 'argon2'
import { AppError } from '../errors.ts'

const MIN_LENGTH = 10
const MAX_LENGTH = 128

/**
 * 자주 쓰이는 비밀번호 목록. 복잡도를 강제하는 대신 이쪽을 막는다.
 * 특수문자 강제는 'Password1!' 같은 예측 가능한 패턴만 양산한다(NIST 권고).
 */
const BLOCKLIST = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'qwerty123456', 'qwertyuiop', '1234567890', '12345678901',
  'iloveyou123', 'admin12345', 'letmein123', 'welcome123',
  'abcd123456', 'p@ssw0rd12',
])

export function assertValidPassword(pw: string): void {
  if (pw.length < MIN_LENGTH) {
    throw new AppError(400, 'PASSWORD_TOO_SHORT', `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`)
  }
  if (pw.length > MAX_LENGTH) {
    throw new AppError(400, 'PASSWORD_TOO_LONG', `비밀번호는 ${MAX_LENGTH}자 이하여야 합니다.`)
  }
  if (BLOCKLIST.has(pw.toLowerCase())) {
    throw new AppError(400, 'PASSWORD_TOO_COMMON', '너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해주세요.')
  }
}

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw)
  } catch {
    // 해시 형식이 깨진 경우 — 검증 실패로 처리하고 예외를 밖으로 내보내지 않는다.
    return false
  }
}
