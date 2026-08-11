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

/** 작은따옴표를 두 번 겹쳐 SQL 문자열 리터럴로 만든다. */
function quoteSqlText(text: string): string {
  return `'${text.replaceAll("'", "''")}'`
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return quoteSqlText(value.toISOString())
  if (typeof value === 'object') return quoteSqlText(JSON.stringify(value))
  return quoteSqlText(String(value))
}

/**
 * `$1` 자리표시자를 실제 값으로 채워 그대로 실행 가능한 SQL을 만든다. 자리표시자와
 * 값 배열을 눈으로 짝지어야 하면 DB 툴에 붙여넣어 확인하기가 번거롭다.
 *
 * 반드시 마스킹된 파라미터를 넘겨야 한다. 이 함수는 값을 가리지 않는다.
 *
 * 자리 번호가 범위를 벗어나면 자리표시자를 그대로 둔다. 없는 값을 NULL로 채우면
 * 원래 쿼리와 다른 쿼리가 로그에 남는다.
 */
export function inlineQueryParams(sql: string, params: unknown[]): string {
  return sql.replaceAll(/\$(\d+)/g, (placeholder, index: string) => {
    const position = Number(index)
    if (position < 1 || position > params.length) return placeholder
    return toSqlLiteral(params[position - 1])
  })
}

export function createQueryLogger(): DrizzleLogger {
  return {
    logQuery(query, params) {
      // SQL은 남은 필드가 아니라 메시지 자리에 넣는다. 필드로 넣으면 JSON
      // 직렬화를 거치면서 Postgres가 식별자를 감싼 따옴표가 전부 \"로 escape돼
      // 읽을 수 없게 된다. 메시지는 렌더러가 그대로 출력한다.
      appLogger?.debug(inlineQueryParams(query, maskQueryParams(params)))
    },
  }
}
