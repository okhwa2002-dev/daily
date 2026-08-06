import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildApp } from '../app.ts'
import { AppError } from '../errors.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  app.get('/boom-app', async () => {
    throw new AppError(409, 'ALREADY_EXISTS', '이미 존재합니다.')
  })
  app.get('/boom-unknown', async () => {
    throw new Error('DB password is hunter2')
  })
  app.post('/boom-zod', async (req) => {
    return z.object({ amount: z.number() }).parse(req.body)
  })
  await app.ready()
})

afterAll(async () => { await app.close() })

describe('전역 에러 핸들러', () => {
  it('헬스체크는 200을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'OK' })
  })

  it('AppError는 지정한 상태코드와 code로 변환된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-app' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({
      code: 'ALREADY_EXISTS',
      message: '이미 존재합니다.',
    })
    expect(res.json().error.requestId).toBeTruthy()
  })

  it('zod 검증 실패는 400 VALIDATION_FAILED로 변환된다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/boom-zod', payload: { amount: '숫자가 아님' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('예상 못 한 에러는 내부 메시지를 노출하지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-unknown' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.json())).not.toContain('hunter2')
    expect(JSON.stringify(res.json())).not.toContain('stack')
  })
})
