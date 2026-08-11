import type { Logger as DrizzleLogger } from 'drizzle-orm'
import { env } from '../env.ts'
import { appLogger } from '../logging/logger.ts'

const SHA256_HEX = /^[0-9a-f]{64}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 쿼리 로그는 개발환경 전용이다. 운영에서는 로거 객체 자체를 만들지 않으므로
 * SQL과 파라미터가 로그로 나갈 경로가 없다.
 */
export const queryLoggingEnabled = env.NODE_ENV === 'development'

function maskEmail(value: string): string {
  const [local, domain] = value.split('@')
  // 도메인은 남긴다. 어느 계정에 대한 쿼리인지는 추적할 수 있어야 한다.
  return `${local?.slice(0, 1) ?? ''}***@${domain}`
}

function maskValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.startsWith('$argon2')) return '***argon2***'
  if (SHA256_HEX.test(value)) return '***hash***'
  if (EMAIL.test(value)) return maskEmail(value)
  return value
}

/**
 * Drizzle 로거는 파라미터가 어느 컬럼에서 왔는지 알려주지 않는다. 값의 모양으로만
 * 판정하므로 테이블이 새로 생겨도 규칙이 그대로 유효하다.
 *
 * 덮는 값: `users.password_hash`(argon2), `refresh_tokens.token_hash`와
 * `password_reset_tokens.token_hash`(sha256 hex), `users.email`.
 */
export function maskQueryParams(params: unknown[]): unknown[] {
  return params.map(maskValue)
}

export function createQueryLogger(): DrizzleLogger {
  return {
    logQuery(query, params) {
      // SQL은 남은 필드가 아니라 메시지 자리에 넣는다. 필드로 넣으면 JSON
      // 직렬화를 거치면서 Postgres가 식별자를 감싼 따옴표가 전부 \"로 escape돼
      // 읽을 수 없게 된다. 메시지는 렌더러가 그대로 출력한다.
      appLogger?.debug({ params: maskQueryParams(params) }, query)
    },
  }
}
