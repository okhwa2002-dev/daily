import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createQueryLogger,
  inlineQueryParams,
  maskQueryParams,
  queryLoggingEnabled,
} from './query-logger.ts'

// 공용 로거를 실제로 만들면 로그 파일이 생긴다. 호출만 관찰한다.
// vi.mock 팩토리는 파일 최상단으로 끌어올려지므로, 그 안에서 쓸 목은
// vi.hoisted로 함께 끌어올려야 초기화 전 참조 오류가 나지 않는다.
const { debug } = vi.hoisted(() => ({ debug: vi.fn() }))
vi.mock('../logging/logger.ts', () => ({ appLogger: { debug } }))

beforeEach(() => {
  debug.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('비밀번호 해시와 토큰 해시를 가린다', () => {
  expect(maskQueryParams(['$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$hash'])).toEqual(['***argon2***'])
  expect(maskQueryParams(['0123456789abcdef'.repeat(4)])).toEqual(['***hash***'])
})

it('이메일은 첫 글자와 도메인만 남긴다', () => {
  expect(maskQueryParams(['user@example.com'])).toEqual(['u***@example.com'])
})

it('아이디·사용자 입력·비문자열은 그대로 둔다', () => {
  expect(maskQueryParams(['testuser', 42, null, '점심 김밥'])).toEqual(['testuser', 42, null, '점심 김밥'])
})

it('64자가 아닌 hex 문자열은 해시로 보지 않는다', () => {
  expect(maskQueryParams(['abc123', '0123456789abcdef'])).toEqual(['abc123', '0123456789abcdef'])
})

it('타입별로 SQL 리터럴을 만든다', () => {
  const sql = 'insert into t values ($1, $2, $3, $4, $5)'

  expect(inlineQueryParams(sql, ['텍스트', 42, null, true, undefined]))
    .toBe("insert into t values ('텍스트', 42, NULL, TRUE, NULL)")
})

it('값 안의 작은따옴표를 겹쳐 리터럴을 깨뜨리지 않는다', () => {
  expect(inlineQueryParams('select $1', ["can't stop"])).toBe("select 'can''t stop'")
})

it('두 자리 자리표시자를 앞자리만 보고 자르지 않는다', () => {
  const params = Array.from({ length: 12 }, (_, i) => i + 1)

  expect(inlineQueryParams('select $1, $10, $12', params)).toBe('select 1, 10, 12')
})

it('범위를 벗어난 자리표시자는 그대로 둔다', () => {
  expect(inlineQueryParams('select $1, $2', ['only'])).toBe("select 'only', $2")
})

it('logQuery는 마스킹된 값을 채운 실행 가능한 SQL을 넘긴다', () => {
  createQueryLogger().logQuery(
    'select "id" from "users" where "users"."email" = $1',
    ['user@example.com'],
  )

  // 메시지 자리는 렌더러가 그대로 출력하므로 여기서 깨끗하면 최종 로그도 깨끗하다.
  expect(debug).toHaveBeenCalledWith(
    `select "id" from "users" where "users"."email" = 'u***@example.com'`,
  )
})

it('인라인된 값도 마스킹을 유지한다', () => {
  createQueryLogger().logQuery('insert into "users" ("password_hash") values ($1)', [
    '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$hash',
  ])

  expect(debug).toHaveBeenCalledWith(`insert into "users" ("password_hash") values ('***argon2***')`)
})

it('테스트 환경에서는 쿼리 로깅이 꺼져 있다', () => {
  expect(queryLoggingEnabled).toBe(false)
})

it('개발 환경에서는 쿼리 로깅이 켜진다', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.resetModules()

  const { queryLoggingEnabled: enabled } = await import('./query-logger.ts')

  expect(enabled).toBe(true)
})
