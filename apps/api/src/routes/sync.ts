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
  /**
   * 클라이언트 스키마 버전. push와 같은 게이트를 pull에도 건다.
   *
   * 필수로 두는 것이 핵심이다 — 구버전(v1) 클라이언트는 이 파라미터를 아예
   * 보내지 않는다. 옵셔널이면 "버전을 안 보내는 구버전" 요청이 그냥 통과해
   * 버려서 이 게이트가 있으나 마나 하다.
   */
  schemaVersion: z.coerce.number().int(),
  /** 커서의 `synced_at`. 없으면 초기 동기화 */
  since: z.string().min(1).optional(),
  sinceId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(PULL_MAX_LIMIT).default(PULL_MAX_LIMIT),
})

/**
 * 클라이언트와 서버의 스키마 버전이 어긋나면 즉시 막는다. push·pull 양쪽에 건다.
 *
 * PWA는 사용자가 캐시된 구버전을 오래 유지한다.
 * - push에서 이 방어가 없으면 구버전이 잘못된 모양의 데이터를 계속 밀어 넣고,
 *   그 결과는 DB에 남는다.
 * - pull에서 이 방어가 없으면 구버전 클라이언트가 모르는 테이블(예: books)의
 *   행을 받는다. `APPLIERS[row.table]`이 undefined라 동기화 루프가 예외로
 *   죽고, pull 커서가 그 지점에서 영영 전진하지 못한다. 그 기기는 이후 어떤
 *   변경도 못 받게 되고, 사용자에게는 "다른 기기에서 쓴 게 안 보임"으로만
 *   보인다.
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
    // schemaVersion만 먼저, 나머지 필드와 따로 검사한다. pullQuerySchema를
    // 통째로 parse()하면 버전 누락도 그냥 ZodError(400)가 되어 push와 다르게
    // 취급된다 — 400이면 클라이언트가 Service Worker 갱신을 유도받지 못한다.
    // 파싱 실패(없음·숫자 아님)는 "구버전"으로 간주해 426으로 통일한다.
    const versionField = z.coerce.number().int()
      .safeParse((req.query as Record<string, unknown>).schemaVersion)
    assertSchemaVersion(versionField.success ? versionField.data : Number.NEGATIVE_INFINITY)

    const { since, sinceId, limit } = pullQuerySchema.parse(req.query)

    // since와 sinceId는 한 쌍이다. 하나만 오면 커서가 반쪽이라 행이 누락된다.
    const cursor = since === undefined
      ? INITIAL_CURSOR
      : { syncedAt: since, id: sinceId ?? 0 }

    const response: PullResponse = await pullChanges(req.userId, cursor, limit)
    return reply.status(200).send(response)
  })
}
