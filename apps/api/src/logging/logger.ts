import type { FastifyBaseLogger } from 'fastify'
import pino from 'pino'
import { env } from '../env.ts'
import { createDailyLogStream } from './daily-logger.ts'

// 비밀번호·토큰이 로그에 남지 않도록 차단
const REDACTED_PATHS = ['req.headers.cookie', 'req.headers.authorization', 'req.body.password']

/**
 * 앱 전체가 공유하는 pino 인스턴스.
 *
 * 요청 로그와 DB 쿼리 로그가 같은 파일에 시간순으로 섞이려면 소유자가 하나여야
 * 한다. Fastify 안에서 만들면 `pool.ts`가 `buildApp()`보다 먼저 import되므로
 * DB 계층에서 접근할 수 없다. 그래서 모듈이 소유한다.
 *
 * 테스트는 로그를 내지 않고 외부 로그 디렉터리도 건드리지 않으므로 null이다.
 *
 * 타입을 pino의 `Logger`가 아니라 `FastifyBaseLogger`로 노출한다. 구체 타입을
 * `loggerInstance`로 넘기면 Fastify 제네릭이 그쪽으로 좁혀져 `buildApp()`의
 * 반환 타입과 어긋난다.
 */
export const appLogger: FastifyBaseLogger | null = env.NODE_ENV === 'test'
  ? null
  : pino(
    {
      // 쿼리 로그는 debug다. 개발환경에서만 레벨을 내려 함께 본다.
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: REDACTED_PATHS,
    },
    createDailyLogStream({ logDirectory: env.LOG_DIR }),
  )
