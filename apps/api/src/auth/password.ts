import { randomBytes } from 'node:crypto'
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

/**
 * 계정이 없을 때도 argon2 비용을 똑같이 치르기 위한 더미 해시.
 *
 * 없는 이메일이라고 검증을 건너뛰면 응답이 눈에 띄게 빨라진다. 본문이
 * 동일해도 응답 시간만으로 가입 여부를 알아낼 수 있으므로, 본문을 맞춘
 * 노력이 무의미해진다. 최초 호출 때 한 번만 만들고 재사용한다.
 */
let dummyHashPromise: Promise<string> | null = null

export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHashPromise
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  // 예외를 삼키지 않는다. argon2.verify가 던지는 경우는 저장된 해시가 깨졌거나
  // 네이티브 바인딩이 실패한 때뿐이고, 둘 다 "비밀번호가 틀렸다"가 아니라
  // 서버 장애다. false로 뭉개면 운영자는 사용자의 오타와 데이터 손상을
  // 구분할 수 없다. 전역 에러 핸들러가 500으로 변환하고 전문을 로깅한다.
  return argon2.verify(hash, pw)
}
