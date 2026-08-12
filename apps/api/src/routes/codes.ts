import type { FastifyInstance } from 'fastify'
import { asc, isNull } from 'drizzle-orm'
import type { CodeGroupPayload, CodesResponse } from '@daily/shared'
import { db } from '../db/pool.ts'
import { codeGroups, codes } from '../db/schema.ts'
import { requireAuth } from '../plugins/require-auth.ts'

/**
 * 공통코드 전체를 내려보낸다.
 *
 * **`sync/` 계층과 무관하다.** 사용자가 만드는 데이터가 아니라 push 할 것이
 * 없고, pull 커서에 얹을 이유도 없다. 동기화 엔진을 건드리지 않는 것이 이
 * 설계의 핵심 제약이다.
 *
 * 인증 뒤에 두는 이유는 코드가 비밀이라서가 아니라, 인증 전 화면(로그인·
 * 회원가입)에 코드가 필요 없기 때문이다. 공개 서비스에서 인증 없이 열어둘
 * 이유가 없는 것은 열지 않는다.
 *
 * 조건부 요청(ETag)은 넣지 않는다. 코드는 수십 건 규모다.
 */
export async function codesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/codes', { preHandler: requireAuth }, async (): Promise<CodesResponse> => {
    const groupRows = await db.select({
      groupCode: codeGroups.groupCode,
      name: codeGroups.name,
    }).from(codeGroups)
      .where(isNull(codeGroups.deletedAt))
      .orderBy(asc(codeGroups.groupCode))

    const codeRows = await db.select({
      groupCode: codes.groupCode,
      code: codes.code,
      name: codes.name,
      sortOrder: codes.sortOrder,
    }).from(codes)
      .where(isNull(codes.deletedAt))
      // 클라이언트가 다시 정렬하지 않아도 되게 여기서 끝낸다.
      .orderBy(asc(codes.groupCode), asc(codes.sortOrder))

    const byGroup = new Map<string, CodeGroupPayload>(
      groupRows.map((g) => [g.groupCode, { ...g, codes: [] }]),
    )
    for (const row of codeRows) {
      // 그룹이 삭제됐는데 코드가 남아 있을 수 있다. 그 코드는 내려보내지 않는다.
      byGroup.get(row.groupCode)?.codes.push({
        code: row.code, name: row.name, sortOrder: row.sortOrder,
      })
    }

    return { groups: [...byGroup.values()] }
  })
}
