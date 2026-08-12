import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { env } from './env.ts'
import { AppError } from './errors.ts'
import { appLogger } from './logging/logger.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'
import { syncRoutes } from './routes/sync.ts'
import { codesRoutes } from './routes/codes.ts'

/**
 * 로거는 `logging/logger.ts`가 소유한다. DB 쿼리 로거도 같은 인스턴스를 쓰므로
 * 요청 로그와 쿼리 로그가 한 파일에 시간순으로 남는다.
 *
 * fastify 5의 `logger`는 설정 객체만 받는다(인스턴스를 주면 "logger options
 * only accepts a configuration object"로 죽는다). 인스턴스는 `loggerInstance`다.
 */
function loggerOptions() {
  return appLogger ? { loggerInstance: appLogger } : { logger: { level: 'silent' as const } }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    ...loggerOptions(),
    // 참고: `disableRequestLogging`은 fastify 5에서 deprecated되어 프로세스 경고를
    // 발생시킨다. logger.level을 'silent'로 두면 요청 로그도 함께 억제되므로
    // 별도로 켤 필요가 없다.
    // nginx 뒤에 있으므로 X-Forwarded-For를 신뢰해야 req.ip가 실제 클라이언트 IP가 된다.
    // 이 설정이 없으면 로그인 실패 기록의 IP가 전부 127.0.0.1이 된다.
    // 단, 신뢰하는 홉은 정확히 1개(nginx)로 제한한다. nginx는
    // $proxy_add_x_forwarded_for로 클라이언트가 보낸 X-Forwarded-For 뒤에
    // 실제 IP를 덧붙이므로, true(모든 홉 신뢰)를 주면 proxy-addr가 체인의
    // 가장 왼쪽 — 즉 클라이언트가 마음대로 적은 값 — 을 req.ip로 채택해버린다.
    // 그러면 요청마다 X-Forwarded-For를 바꿔 rate limit과 login_attempts.ip를
    // 둘 다 속일 수 있다. 홉을 1로 제한하면 nginx가 덧붙인, 오른쪽에서 한 칸
    // 안쪽의 실제 클라이언트 IP를 사용한다.
    trustProxy: 1,
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
  await app.register(syncRoutes, { prefix: '/api' })
  await app.register(codesRoutes, { prefix: '/api' })

  return app
}
