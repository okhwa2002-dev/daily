import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.').max(254),
  password: z.string().min(10).max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
})
export type LoginInput = z.infer<typeof loginSchema>

export interface AuthResponse {
  accessToken: string
  user: { id: number; email: string }
}
