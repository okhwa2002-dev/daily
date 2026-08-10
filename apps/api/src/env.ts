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
  // 운영에는 테스트 DB가 없으므로 선택 값이되, 아래 superRefine이
  // NODE_ENV=test일 때는 필수로 만든다.
  DATABASE_URL_TEST: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.coerce.boolean().default(true),
}).superRefine((v, ctx) => {
  // 테스트 실행인데 테스트 DB가 지정되지 않았다면 즉시 죽는다.
  // 조용히 개발 DB로 붙으면 resetDb()가 개발 데이터를 TRUNCATE한다.
  if (v.NODE_ENV === 'test' && !v.DATABASE_URL_TEST) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL_TEST'],
      message: 'NODE_ENV=test에서는 DATABASE_URL_TEST가 반드시 필요합니다.',
    })
  }
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // 어떤 키가 비었는지만 알린다. 값은 절대 출력하지 않는다.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`환경변수 설정 오류: ${missing}`)
}

export const env = parsed.data
