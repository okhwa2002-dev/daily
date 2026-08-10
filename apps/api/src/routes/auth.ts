import type { FastifyInstance, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { loginSchema, registerSchema, type AuthResponse } from '@daily/shared'
import { db } from '../db/pool.ts'
import { users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { env } from '../env.ts'
import { AppError } from '../errors.ts'
import {
  assertValidPassword, dummyPasswordHash, hashPassword, verifyPassword,
} from '../auth/password.ts'
import {
  REFRESH_COOKIE_NAME, issueAccessToken, issueRefreshToken,
  revokeRefreshToken, rotateRefreshToken,
} from '../auth/tokens.ts'
import { loginDelayMs, recordAttempt } from '../auth/throttle.ts'

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms) })

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    // 스키마가 loginId·email을 소문자로 정규화해 준다.
    const input = registerSchema.parse(req.body)
    const { loginId, email } = input
    assertValidPassword(input.password)

    // 아이디 중복은 반드시 알려줘야 한다. 알려주지 않으면 가입 자체가 불가능하다.
    // 이 응답이 아이디 열거를 허용한다는 점은 감수한다 — 아이디로 로그인하는
    // 서비스에서는 피할 수 없는 교환이다.
    const dupLoginId = await db.select({ id: users.id }).from(users)
      .where(eq(users.loginId, loginId))
    if (dupLoginId.length > 0) {
      throw new AppError(409, 'LOGIN_ID_ALREADY_EXISTS', '이미 사용 중인 아이디입니다.')
    }

    const dupEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    if (dupEmail.length > 0) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.')
    }

    const now = dbNow()
    const [created] = await db.insert(users).values({
      loginId,
      email,
      passwordHash: await hashPassword(input.password),
      status: 'ACTIVE',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    }).returning({ id: users.id, loginId: users.loginId, email: users.email })

    const userId = created!.id
    // 생성자 자신을 감사 컬럼에 반영한다.
    await db.update(users)
      .set({ createdBy: userId, updatedBy: userId })
      .where(eq(users.id, userId))

    setRefreshCookie(reply, await issueRefreshToken(userId))
    const body: AuthResponse = {
      accessToken: await issueAccessToken(userId),
      user: { id: userId, loginId: created!.loginId, email: created!.email },
    }
    return reply.status(201).send(body)
  })

  app.post('/auth/login', async (req, reply) => {
    const input = loginSchema.parse(req.body)
    const { loginId } = input
    const ip = req.ip

    await sleep(await loginDelayMs(loginId))

    const [user] = await db.select().from(users).where(eq(users.loginId, loginId))

    // 계정이 없어도 argon2 검증을 반드시 한 번 수행한다. 단축 평가로 건너뛰면
    // 응답 시간이 짧아져, 본문이 같아도 가입 여부가 드러난다.
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? await dummyPasswordHash(),
      input.password,
    )

    const ok = user !== undefined
      && user.status === 'ACTIVE'
      && user.deletedAt === null
      && passwordOk

    if (!ok) {
      await recordAttempt(loginId, ip, false)
      // 계정 존재 여부를 응답으로 구분하지 않는다. 가입 화면이 아이디 중복을
      // 알려주는 것과 별개로, 비밀번호까지 맞혀야 하는 이 경로는 계속 막는다.
      throw new AppError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.')
    }

    await recordAttempt(loginId, ip, true)
    setRefreshCookie(reply, await issueRefreshToken(user.id))
    const body: AuthResponse = {
      accessToken: await issueAccessToken(user.id),
      user: { id: user.id, loginId: user.loginId, email: user.email },
    }
    return reply.status(200).send(body)
  })

  app.post('/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE_NAME]
    if (!raw) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    const { userId, token } = await rotateRefreshToken(raw)
    const [user] = await db.select({
      id: users.id, loginId: users.loginId, email: users.email,
      status: users.status, deletedAt: users.deletedAt,
    }).from(users).where(eq(users.id, userId))

    // 계정 상태를 여기서도 확인한다. 로그인에서만 막으면, 이미 로그인해 둔
    // 사용자는 정지·탈퇴 이후에도 refresh만으로 세션을 무한히 연장할 수 있다.
    // 그러면 계정 정지가 아무 의미가 없다.
    if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) {
      // 방금 발급된 새 토큰까지 즉시 폐기한다. 옛 토큰은 rotate가 이미 죽였다.
      await revokeRefreshToken(token)
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' })
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    setRefreshCookie(reply, token)
    const body: AuthResponse = {
      accessToken: await issueAccessToken(userId),
      user: { id: user.id, loginId: user.loginId, email: user.email },
    }
    return reply.status(200).send(body)
  })

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE_NAME]
    if (raw) await revokeRefreshToken(raw)
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' })
    return reply.status(204).send()
  })
}
