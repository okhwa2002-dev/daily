import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { resetDb } from '../db/testing.ts'
import { loginDelayMs, recordAttempt } from './throttle.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('로그인 실패 지연', () => {
  it('실패 이력이 없으면 지연이 없다', async () => {
    expect(await loginDelayMs('a@example.com')).toBe(0)
  })

  it('실패가 쌓일수록 지연이 두 배씩 늘어난다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(1000)

    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(2000)

    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(4000)
  })

  it('지연에 상한이 있다', async () => {
    for (let i = 0; i < 20; i += 1) {
      await recordAttempt('a@example.com', '1.1.1.1', false)
    }
    expect(await loginDelayMs('a@example.com')).toBe(30_000)
  })

  it('성공하면 지연이 초기화된다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', true)
    expect(await loginDelayMs('a@example.com')).toBe(0)
  })

  it('다른 계정의 실패는 영향을 주지 않는다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('b@example.com')).toBe(0)
  })
})
