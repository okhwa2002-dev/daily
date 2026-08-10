import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  INITIAL_CURSOR, PULL_MAX_LIMIT, SCHEMA_VERSION,
  pushRequestSchema,
  type PullResponse, type PushResponse,
} from '@daily/shared'
import { AppError } from '../errors.ts'
import { requireAuth } from '../plugins/require-auth.ts'
import { applyChanges, serverTime } from '../sync/push.ts'
import { pullChanges } from '../sync/pull.ts'

const pullQuerySchema = z.object({
  /** 커서의 `synced_at`. 없으면 초기 동기화 */
  since: z.string().min(1).optional(),
  sinceId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(PULL_MAX_LIMIT).default(PULL_MAX_LIMIT),
})

/**
 * 클라이언트와 서버의 페이로드 모양이 어긋나면 즉시 막는다.
 *
 * PWA는 사용자가 캐시된 구버전을 오래 유지한다. 이 방어가 없으면 구버전이
 * 잘못된 모양의 데이터를 계속 밀어 넣고, 그 결과는 DB에 남는다.
 */
function assertSchemaVersion(version: number): void {
  if (version === SCHEMA_VERSION) return
  if (version < SCHEMA_VERSION) {
    throw new AppError(
      426, 'UPGRADE_REQUIRED',
      '앱이 오래되었습니다. 새로고침해 최신 버전으로 갱신해주세요.',
    )
  }
  // 클라이언트가 서버보다 최신이다 — 배포가 덜 끝난 상태다.
  // 갱신을 유도해도 소용없으므로 426을 쓰지 않는다.
  throw new AppError(
    409, 'SERVER_OUTDATED',
    '서버 업데이트가 진행 중입니다. 잠시 후 다시 시도해주세요.',
  )
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sync/push', { preHandler: requireAuth }, async (req, reply) => {
    const body = pushRequestSchema.parse(req.body)
    assertSchemaVersion(body.schemaVersion)

    const results = await applyChanges(req.userId, body.changes)
    const response: PushResponse = { results, serverTime: serverTime() }
    return reply.status(200).send(response)
  })

  app.get('/sync/pull', { preHandler: requireAuth }, async (req, reply) => {
    const { since, sinceId, limit } = pullQuerySchema.parse(req.query)

    // since와 sinceId는 한 쌍이다. 하나만 오면 커서가 반쪽이라 행이 누락된다.
    const cursor = since === undefined
      ? INITIAL_CURSOR
      : { syncedAt: since, id: sinceId ?? 0 }

    const response: PullResponse = await pullChanges(req.userId, cursor, limit)
    return reply.status(200).send(response)
  })
}
