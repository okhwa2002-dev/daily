import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

// `.env`는 저장소 루트에 있고 커밋하지 않는다. Node는 이 파일을 자동으로 읽지
// 않으므로 명시적으로 로드한다. 경로를 이 파일 기준으로 잡는 이유는, 실행 위치
// (루트에서 pnpm -r, apps/api에서 vitest 등)에 따라 cwd가 달라지기 때문이다.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.coerce.boolean().default(true),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // 어떤 키가 비었는지만 알린다. 값은 절대 출력하지 않는다.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`환경변수 설정 오류: ${missing}`)
}

export const env = parsed.data
