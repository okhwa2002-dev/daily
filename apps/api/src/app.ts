import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { env } from './env.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      // 비밀번호·토큰이 로그에 남지 않도록 차단
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
    },
    // 참고: `disableRequestLogging`은 fastify 5에서 deprecated되어 프로세스 경고를
    // 발생시킨다. logger.level을 'silent'로 두면 요청 로그도 함께 억제되므로
    // 별도로 켤 필요가 없다.
    // nginx 뒤에 있으므로 X-Forwarded-For를 신뢰해야 req.ip가 실제 클라이언트 IP가 된다.
    // 이 설정이 없으면 로그인 실패 기록의 IP가 전부 127.0.0.1이 된다.
    trustProxy: true,
  })

  await app.register(cookie)
  registerErrorHandler(app)
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api' })

  return app
}
