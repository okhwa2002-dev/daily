import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { env } from './env.ts'
import { AppError } from './errors.ts'
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
  // 테스트에서는 상한을 사실상 무제한에 가깝게 두어 순서 의존적인
  // 산발적 실패를 막는다. 실제 상한은 운영 환경에서만 적용된다.
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
    // 기본 errorResponseBuilder는 `{statusCode, error, message}` 모양의 일반
    // Error를 던진다. 이 프로젝트의 전역 에러 핸들러는 AppError만 표준 계약
    // (`{ error: { code, message, requestId } }`)으로 변환하므로, 일반 Error나
    // 평범한 객체는 catch-all 500 분기로 떨어져 429가 500으로 둔갑한다.
    // AppError를 직접 던지면 기존 핸들러 분기를 그대로 타고 429 상태와
    // 표준 계약을 함께 얻는다.
    errorResponseBuilder: (req, context) => new AppError(
      429,
      'RATE_LIMITED',
      `요청이 너무 많습니다. ${context.after} 후에 다시 시도해주세요.`,
    ),
  })
  registerErrorHandler(app)
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api' })

  return app
}
