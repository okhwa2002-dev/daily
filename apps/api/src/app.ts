import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { env } from './env.ts'
import { AppError } from './errors.ts'
import { createApiLogger } from './logging/api-logger.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'
import { syncRoutes } from './routes/sync.ts'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: createApiLogger({
      environment: env.NODE_ENV,
      logDirectory: 'D:\\workspace\\ok2020\\log\\daily',
    }) as FastifyBaseLogger,
    trustProxy: 1,
  })

  await app.register(cookie)
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (req, context) => new AppError(
      429,
      'RATE_LIMITED',
      `요청이 너무 많습니다. ${context.after} 후에 다시 시도해 주세요.`,
    ),
  })
  registerErrorHandler(app)
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api' })
  await app.register(syncRoutes, { prefix: '/api' })

  return app
}
