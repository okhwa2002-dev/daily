import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { verifyAccessToken } from '../auth/tokens.ts'
import { db } from '../db/pool.ts'
import { users } from '../db/schema.ts'
import { AppError } from '../errors.ts'

declare module 'fastify' {
  interface FastifyRequest {
    /** requireAuth가 주입한다. 요청 본문의 사용자 ID는 신뢰하지 않는다. */
    userId: number
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
  }
  const userId = await verifyAccessToken(header.slice('Bearer '.length))

  // 서명·만료만 보면 정지·탈퇴된 계정도 토큰이 만료될 때까지(최대 15분) 통과한다.
  // 이 훅이 지키는 것이 사용자의 건강·지출 기록이므로 그 15분을 허용하지 않는다.
  // 캐시를 두면 "정지가 즉시 반영되지 않는다"가 그대로 되살아나므로 두지 않는다.
  const [user] = await db.select({ status: users.status, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, userId))

  if (!user) {
    // 서명은 유효한데 계정이 없다 — 파기된 계정의 토큰이다.
    throw new AppError(401, 'UNAUTHORIZED', '로그인이 필요합니다.')
  }
  if (user.status !== 'ACTIVE' || user.deletedAt !== null) {
    // 토큰 갱신으로는 풀리지 않는 상태다. 코드를 구분해 주지 않으면 클라이언트가
    // refresh를 시도했다 실패하고 "로그인이 필요합니다"만 반복해서 보여준다.
    throw new AppError(403, 'ACCOUNT_INACTIVE', '이용할 수 없는 계정입니다.')
  }

  req.userId = userId
}
