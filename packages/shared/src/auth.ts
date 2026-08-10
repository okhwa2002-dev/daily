import { z } from 'zod'

/**
 * DB에 저장되는 아이디의 모양. 서버가 정규화를 마친 뒤의 형태다.
 * DB CHECK 제약과 같은 규칙이어야 한다.
 */
export const NORMALIZED_LOGIN_ID = /^[a-z0-9_]{4,20}$/

/**
 * 로그인 아이디.
 *
 * 입력은 대소문자를 가리지 않고 받되 **소문자로 정규화해 저장한다.**
 * 'Kim'과 'kim'이 서로 다른 계정이 되면 사용자는 로그인이 왜 안 되는지 알 수 없고,
 * 비슷한 아이디로 남을 사칭하는 것도 가능해진다.
 */
export const loginIdSchema = z.string()
  .trim()
  .regex(/^[A-Za-z0-9_]{4,20}$/, '아이디는 영문·숫자·밑줄 4~20자여야 합니다.')
  .transform((v) => v.toLowerCase())

/** 이메일도 같은 이유로 소문자로 정규화한다. */
export const emailSchema = z.string()
  .trim()
  .max(254)
  .email('올바른 이메일 형식이 아닙니다.')
  .transform((v) => v.toLowerCase())

/**
 * 이메일은 로그인에 쓰지 않지만 가입 시 반드시 받는다.
 * 비밀번호를 잊었을 때 계정을 되찾을 유일한 수단이다.
 */
export const registerSchema = z.object({
  loginId: loginIdSchema,
  email: emailSchema,
  password: z.string().min(10).max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  loginId: loginIdSchema,
  password: z.string().min(1).max(128),
})
export type LoginInput = z.infer<typeof loginSchema>

export interface AuthResponse {
  accessToken: string
  user: { id: number; loginId: string; email: string }
}
