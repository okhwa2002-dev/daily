import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAccessToken } from '../auth/tokens.ts'
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
  req.userId = await verifyAccessToken(header.slice('Bearer '.length))
}
