import type { FastifyError, FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '../errors.ts'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | AppError | ZodError>((err, req, reply) => {
    // zod 스키마 검증 실패 — 라우트에서 schema.parse()가 던진다.
    // 이 분기가 없으면 잘못된 입력이 전부 500으로 나간다.
    if (err instanceof ZodError) {
      req.log.warn({ reqId: req.id }, 'zod validation failed')
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '요청 형식이 올바르지 않습니다.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId: req.id,
        },
      })
    }

    if (err instanceof AppError) {
      req.log.warn({ code: err.code, reqId: req.id }, 'app error')
      return reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId: req.id,
        },
      })
    }

    if (err.validation) {
      req.log.warn({ reqId: req.id }, 'validation failed')
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '요청 형식이 올바르지 않습니다.',
          requestId: req.id,
        },
      })
    }

    // 예상 못 한 에러 — 상세는 로그에만 남긴다.
    req.log.error({ err, reqId: req.id }, 'unhandled error')
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '서버 오류가 발생했습니다.',
        requestId: req.id,
      },
    })
  })

  app.setNotFoundHandler((req, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: '없는 경로입니다.', requestId: req.id },
    })
  })
}
