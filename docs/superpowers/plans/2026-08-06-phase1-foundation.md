# 1단계 기반 구축 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모노레포·DB·인증·프론트 셸을 갖춘, 회원가입과 로그인이 동작하는 애플리케이션을 만든다.

**Architecture:** pnpm workspace 아래 `apps/web`(Vite React PWA), `apps/api`(Fastify), `packages/shared`(zod 스키마·코드값·날짜 유틸)를 둔다. 인증은 메모리 액세스 토큰 + httpOnly 쿠키 리프레시 토큰 구조이며, 리프레시는 사용할 때마다 로테이션되고 재사용이 탐지되면 세션 전체를 무효화한다. 프론트는 이 단계에서 Dexie 스키마와 아웃박스 테이블 정의까지만 만들고, 동기화 엔진은 2단계에서 붙인다.

**Tech Stack:** Node 22 LTS, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 18, argon2, jose, Vite, React 19, Tailwind CSS v4, Dexie, Zustand, Vitest

**설계 문서:** [2026-08-06-daily-tracker-design.md](../specs/2026-08-06-daily-tracker-design.md)

## Global Constraints

프로젝트 전체에 적용된다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **런타임**: Node 22 LTS. 모든 패키지는 ESM (`"type": "module"`)
- **TypeScript**: `strict: true`, `verbatimModuleSyntax: true`. 타입 전용 import는 반드시 `import type`
- **패키지 매니저**: pnpm workspace
- **코드성 데이터는 값을 대문자로 관리한다.** 여러 단어는 `SCREAMING_SNAKE_CASE` (`PENDING_DELETION`, `FULL_BODY`). 컬럼명·테이블명은 snake_case 소문자
- **DB 시각 컬럼은 `TIMESTAMP`(타임존 없음)에 KST 로컬 시각을 저장한다.** `TIMESTAMPTZ` 사용 금지
- **`_at` 컬럼을 만들면 짝이 되는 `_by` 컬럼을 반드시 함께 만들고 해당 사용자 ID를 넣는다**
  - 행위자가 존재하지 않는 경우(가입 직전, 시스템 배치)는 `0`을 시스템 사용자 sentinel로 넣는다
  - 예외: `login_attempts.attempted_at`. 인증 **전** 이벤트라 행위자 ID가 존재하지 않을 수 있다(없는 계정으로 시도한 경우). 대신 `email`과 `ip`를 남긴다
- **소프트 삭제**: `deleted_at`이 있는 테이블은 물리 삭제 금지. 조회 시 `deleted_at IS NULL` 필수 (동기화 pull만 예외)
- **소유권 격리**: 모든 도메인 쿼리에 `user_id = :userId` 포함. `userId`는 인증 미들웨어가 주입한 값만 사용하며 요청 본문·쿼리스트링의 사용자 ID는 신뢰하지 않는다
- **금액**은 `NUMERIC(12,2)`. `FLOAT`/`DOUBLE` 금지
- **비밀값은 `.env`에만 둔다.** 문서·주석·커밋 메시지·로그에 실제 비밀값을 적지 않는다
- **로그 금지 항목**: 비밀번호, 토큰, 세션 값, 일기 본문, 지출 내역. 디버깅이 필요하면 레코드 ID만 남긴다
- **커밋**은 각 태스크 끝에서 한 번. 테스트가 통과한 상태에서만 커밋한다

## File Structure

```
daily/
├── pnpm-workspace.yaml            # 워크스페이스 정의
├── package.json                   # 루트 스크립트, 공통 devDependencies
├── tsconfig.base.json             # 공통 TS 설정 (strict, verbatimModuleSyntax)
├── .env.example                   # 환경변수 형식만 (값 없음)
│
├── packages/shared/
│   └── src/
│       ├── index.ts               # 공개 API 재노출
│       ├── codes.ts               # 코드성 데이터 상수·타입 (대문자 값)
│       ├── datetime.ts            # KST 변환 유틸
│       └── auth.ts                # 인증 요청/응답 zod 스키마
│
├── apps/api/
│   ├── drizzle.config.ts
│   └── src/
│       ├── main.ts                # 프로세스 진입점 (listen)
│       ├── app.ts                 # Fastify 앱 팩토리 (테스트에서 재사용)
│       ├── env.ts                 # 환경변수 로드·검증
│       ├── errors.ts              # AppError 정의
│       ├── db/
│       │   ├── pool.ts            # pg Pool + 타입 파서
│       │   ├── schema.ts          # drizzle 테이블 정의
│       │   └── time.ts            # DB용 KST 시각 생성
│       ├── plugins/
│       │   ├── error-handler.ts   # 전역 에러 → 응답 변환
│       │   └── require-auth.ts    # 액세스 토큰 검증 → req.userId 주입
│       ├── auth/
│       │   ├── password.ts        # 정책 검증 + argon2 해싱
│       │   ├── tokens.ts          # 액세스 JWT + 리프레시 토큰 발급/검증
│       │   └── throttle.ts        # 로그인 실패 기록 + 지수 지연
│       └── routes/
│           ├── health.ts
│           └── auth.ts            # register / login / refresh / logout
│
└── apps/web/
    └── src/
        ├── main.tsx
        ├── App.tsx                # 라우팅 + 인증 게이트
        ├── index.css              # Tailwind v4 진입
        ├── db/
        │   └── index.ts           # Dexie 스키마 (도메인 테이블 + outbox + meta)
        ├── lib/
        │   └── apiClient.ts       # fetch 래퍼 (액세스 토큰 주입, 401 시 refresh)
        ├── store/
        │   └── session.ts         # Zustand 세션 상태
        └── pages/
            ├── LoginPage.tsx
            └── RegisterPage.tsx
```

파일 분리 기준은 **함께 바뀌는 것을 함께 둔다**이다. `auth/`는 비밀번호·토큰·스로틀이 인증 정책 변경 시 같이 움직이므로 한 폴더에 모으고, 라우트는 HTTP 관심사만 담아 얇게 유지한다.

---

## Task 1: 모노레포 스캐폴딩과 코드값 정의

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/codes.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/codes.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `@daily/shared`에서 `EXPENSE_KIND`, `WORKOUT_KIND`, `BODY_PART`, `INTENSITY`, `MEAL_SLOT`, `PORTION`, `BOOK_STATUS`, `USER_STATUS`, `OUTBOX_OP`, `SYNC_RESULT` 상수 배열과 동명의 타입(`ExpenseKind` 등), `ALL_CODES` 배열

- [ ] **Step 1: 워크스페이스 뼈대 파일 생성**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`package.json`:

```json
{
  "name": "daily",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vitest": "^4.1.6"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "isolatedModules": true
  }
}
```

`.env.example` — **값을 채우지 않는다.** 형식만 적는다:

```
# API
PORT=3001
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/daily
DATABASE_URL_TEST=postgres://USER:PASSWORD@localhost:5432/daily_test

# 인증
JWT_SECRET=
ACCESS_TOKEN_TTL_SEC=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
```

`packages/shared/package.json`:

```json
{
  "name": "@daily/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

`allowImportingTsExtensions`가 필요한 이유: 이 계획의 모든 import는 `./codes.ts`처럼 확장자를 명시한다(ESM 해석 규칙과 tsx/Vite 양쪽에서 동작하는 형태). 이 플래그가 없으면 `tsc`가 `TS5097`로 거부한다. 플래그는 `noEmit` 또는 `emitDeclarationOnly`를 요구하므로 각 패키지 tsconfig가 `noEmit: true`를 켠다.

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/shared/src/codes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_CODES, EXPENSE_KIND, MEAL_SLOT, USER_STATUS } from './codes.ts'

describe('코드성 데이터', () => {
  it('모든 코드값은 대문자와 밑줄만 사용한다', () => {
    expect(ALL_CODES.length).toBeGreaterThan(0)
    for (const code of ALL_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('코드값에 중복이 없다', () => {
    for (const group of [EXPENSE_KIND, MEAL_SLOT, USER_STATUS]) {
      expect(new Set(group).size).toBe(group.length)
    }
  })

  it('지출 구분은 INCOME과 EXPENSE 두 가지다', () => {
    expect(EXPENSE_KIND).toEqual(['INCOME', 'EXPENSE'])
  })
})
```

첫 번째 테스트가 이 프로젝트의 코드값 규칙을 강제한다. 나중에 누군가 `'fullbody'`를 추가하면 여기서 잡힌다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @daily/shared test`
Expected: FAIL — `Failed to resolve import "./codes.ts"`

- [ ] **Step 4: 코드값 구현**

`packages/shared/src/codes.ts`:

```ts
export const EXPENSE_KIND = ['INCOME', 'EXPENSE'] as const
export type ExpenseKind = (typeof EXPENSE_KIND)[number]

export const WORKOUT_KIND = ['STRENGTH', 'CARDIO', 'ETC'] as const
export type WorkoutKind = (typeof WORKOUT_KIND)[number]

export const BODY_PART = [
  'CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'FULL_BODY',
] as const
export type BodyPart = (typeof BODY_PART)[number]

export const INTENSITY = ['LOW', 'MID', 'HIGH'] as const
export type Intensity = (typeof INTENSITY)[number]

export const MEAL_SLOT = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const
export type MealSlot = (typeof MEAL_SLOT)[number]

export const PORTION = ['LIGHT', 'NORMAL', 'HEAVY'] as const
export type Portion = (typeof PORTION)[number]

export const BOOK_STATUS = ['READING', 'DONE', 'WISHLIST'] as const
export type BookStatus = (typeof BOOK_STATUS)[number]

export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION'] as const
export type UserStatus = (typeof USER_STATUS)[number]

export const OUTBOX_OP = ['UPSERT', 'DELETE'] as const
export type OutboxOp = (typeof OUTBOX_OP)[number]

export const SYNC_RESULT = ['APPLIED', 'STALE', 'CONFLICT', 'REJECTED'] as const
export type SyncResult = (typeof SYNC_RESULT)[number]

/** 코드값 규칙 검증용 — 새 코드 그룹을 추가하면 여기에도 넣는다. */
export const ALL_CODES: readonly string[] = [
  ...EXPENSE_KIND, ...WORKOUT_KIND, ...BODY_PART, ...INTENSITY,
  ...MEAL_SLOT, ...PORTION, ...BOOK_STATUS, ...USER_STATUS,
  ...OUTBOX_OP, ...SYNC_RESULT,
]
```

`packages/shared/src/index.ts`:

```ts
export * from './codes.ts'
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm install && pnpm --filter @daily/shared test`
Expected: PASS — 3 tests

- [ ] **Step 6: 커밋**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json .env.example packages/
git commit -m "feat: pnpm 워크스페이스 구성과 코드값 정의"
```

`pnpm-lock.yaml`을 반드시 커밋한다. 배포 절차가 `pnpm install --frozen-lockfile`을 쓰므로 락파일이 없으면 배포가 실패하고, 태스크마다 의존성 버전이 달라진다.

---

## Task 2: KST 날짜 유틸

**Files:**
- Create: `packages/shared/src/datetime.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/datetime.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `toKstTimestamp(d: Date): string` (`'YYYY-MM-DD HH:mm:ss.SSS'`), `fromKstTimestamp(s: string): Date`, `kstDate(d: Date): string` (`'YYYY-MM-DD'`)

DB의 모든 시각 컬럼이 KST 로컬 시각을 담으므로, `Date`와 DB 문자열 사이의 변환을 한 곳으로 모은다. **이 변환이 흩어지면 기기 타임존이 다를 때 충돌 판정이 뒤집힌다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/shared/src/datetime.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fromKstTimestamp, kstDate, toKstTimestamp } from './datetime.ts'

describe('KST 변환', () => {
  it('UTC 시각을 KST 벽시계 문자열로 바꾼다', () => {
    // 2026-08-05T15:00:00Z = 2026-08-06 00:00 KST
    expect(toKstTimestamp(new Date('2026-08-05T15:00:00.000Z')))
      .toBe('2026-08-06 00:00:00.000')
  })

  it('KST 문자열을 Date로 되돌린다', () => {
    expect(fromKstTimestamp('2026-08-06 00:00:00.000').toISOString())
      .toBe('2026-08-05T15:00:00.000Z')
  })

  it('왕복 변환이 원본과 같다', () => {
    const original = new Date('2026-02-28T23:45:12.345Z')
    expect(fromKstTimestamp(toKstTimestamp(original)).getTime())
      .toBe(original.getTime())
  })

  it('날짜 경계에서 KST 기준 날짜를 반환한다', () => {
    // UTC로는 8월 5일이지만 KST로는 8월 6일
    expect(kstDate(new Date('2026-08-05T15:30:00.000Z'))).toBe('2026-08-06')
    // UTC로는 아직 8월 5일이지만 KST로는 이미 8월 6일 08:59
    expect(kstDate(new Date('2026-08-05T23:59:00.000Z'))).toBe('2026-08-06')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @daily/shared test datetime`
Expected: FAIL — `Failed to resolve import "./datetime.ts"`

- [ ] **Step 3: 구현**

`packages/shared/src/datetime.ts`:

```ts
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * Date를 DB 저장용 KST 벽시계 문자열로 변환한다.
 * 반환 형식: 'YYYY-MM-DD HH:mm:ss.SSS'
 */
export function toKstTimestamp(d: Date): string {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS)
  return shifted.toISOString().replace('T', ' ').slice(0, 23)
}

/** DB에서 읽은 KST 벽시계 문자열을 Date로 되돌린다. */
export function fromKstTimestamp(s: string): Date {
  const normalized = s.trim().replace(' ', 'T')
  const withMillis = normalized.includes('.') ? normalized : `${normalized}.000`
  return new Date(`${withMillis}+09:00`)
}

/** KST 기준 날짜만 반환한다. 반환 형식: 'YYYY-MM-DD' */
export function kstDate(d: Date): string {
  return toKstTimestamp(d).slice(0, 10)
}
```

`packages/shared/src/index.ts`에 추가:

```ts
export * from './codes.ts'
export * from './datetime.ts'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @daily/shared test`
Expected: PASS — 7 tests

- [ ] **Step 5: 커밋**

```bash
git add packages/shared
git commit -m "feat: KST 시각 변환 유틸 추가"
```

---

## Task 3: API 스캐폴딩과 전역 에러 처리

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/errors.ts`
- Create: `apps/api/src/plugins/error-handler.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/main.ts`
- Test: `apps/api/src/plugins/error-handler.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `buildApp(): Promise<FastifyInstance>`, `AppError` 클래스(`status`, `code`, `message`, `details`), `env` 객체(`PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`)

- [ ] **Step 1: 패키지 설치와 설정 파일 생성**

```bash
pnpm --filter @daily/api add fastify @fastify/cookie @fastify/rate-limit @fastify/cors pino zod dotenv
pnpm --filter @daily/api add -D @types/node@^22 tsx vitest
```

`apps/api/package.json`:

```json
{
  "name": "@daily/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@daily/shared": "workspace:*"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "drizzle.config.ts"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', globals: false },
})
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/api/src/plugins/error-handler.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildApp } from '../app.ts'
import { AppError } from '../errors.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  app.get('/boom-app', async () => {
    throw new AppError(409, 'ALREADY_EXISTS', '이미 존재합니다.')
  })
  app.get('/boom-unknown', async () => {
    throw new Error('DB password is hunter2')
  })
  app.post('/boom-zod', async (req) => {
    return z.object({ amount: z.number() }).parse(req.body)
  })
  await app.ready()
})

afterAll(async () => { await app.close() })

describe('전역 에러 핸들러', () => {
  it('헬스체크는 200을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'OK' })
  })

  it('AppError는 지정한 상태코드와 code로 변환된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-app' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({
      code: 'ALREADY_EXISTS',
      message: '이미 존재합니다.',
    })
    expect(res.json().error.requestId).toBeTruthy()
  })

  it('zod 검증 실패는 400 VALIDATION_FAILED로 변환된다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/boom-zod', payload: { amount: '숫자가 아님' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('예상 못 한 에러는 내부 메시지를 노출하지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-unknown' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.json())).not.toContain('hunter2')
    expect(JSON.stringify(res.json())).not.toContain('stack')
  })
})
```

zod 테스트가 실제 결함을 막는다. **라우트에서 `schema.parse()`가 던지는 `ZodError`를 처리하지 않으면 잘못된 입력이 전부 500으로 나가고**, Task 8의 "짧은 비밀번호는 400" 테스트가 깨진다.

마지막 테스트는 에러 응답으로 내부 정보가 새는 것을 회귀 테스트로 막는다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @daily/api test`
Expected: FAIL — `Failed to resolve import "../app.ts"`

- [ ] **Step 4: 구현**

`apps/api/src/env.ts`:

```ts
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
```

`apps/api/src/errors.ts`:

```ts
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
```

`apps/api/src/plugins/error-handler.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '../errors.ts'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    // zod 스키마 검증 실패 — 라우트에서 schema.parse()가 던진다.
    // 이 분기가 없으면 잘못된 입력이 전부 500으로 나간다.
    if (err instanceof ZodError) {
      req.log.warn({ reqId: req.id }, 'zod validation failed')
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '요청 형식이 올바르지 않습니다.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId: req.id,
        },
      })
    }

    if (err instanceof AppError) {
      req.log.warn({ code: err.code, reqId: req.id }, 'app error')
      return reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId: req.id,
        },
      })
    }

    if (err.validation) {
      req.log.warn({ reqId: req.id }, 'validation failed')
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '요청 형식이 올바르지 않습니다.',
          requestId: req.id,
        },
      })
    }

    // 예상 못 한 에러 — 상세는 로그에만 남긴다.
    req.log.error({ err, reqId: req.id }, 'unhandled error')
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '서버 오류가 발생했습니다.',
        requestId: req.id,
      },
    })
  })

  app.setNotFoundHandler((req, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: '없는 경로입니다.', requestId: req.id },
    })
  })
}
```

`apps/api/src/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'OK' }))
}
```

`apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { env } from './env.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { healthRoutes } from './routes/health.ts'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      // 비밀번호·토큰이 로그에 남지 않도록 차단
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
    },
    disableRequestLogging: env.NODE_ENV === 'test',
  })

  await app.register(cookie)
  registerErrorHandler(app)
  await app.register(healthRoutes, { prefix: '/api' })

  return app
}
```

`apps/api/src/main.ts`:

```ts
import { buildApp } from './app.ts'
import { env } from './env.ts'

const app = await buildApp()
await app.listen({ port: env.PORT, host: '0.0.0.0' })
```

- [ ] **Step 5: 로컬 `.env` 준비 후 테스트 통과 확인**

저장소 루트의 `.env.example`을 같은 위치의 `.env`로 복사하고 `JWT_SECRET`에 32자 이상 임의 값을 넣는다 (`openssl rand -base64 48`). `.env`는 `.gitignore`에 이미 들어 있으므로 커밋되지 않는다 — **생성한 값을 커밋 메시지나 보고서에 적지 않는다.**

`DATABASE_URL`은 이 태스크에서 연결에 쓰이지 않으므로 `.env.example`의 형식 그대로 두어도 된다. 실제 DB는 Task 4에서 만든다.

vitest는 `NODE_ENV`를 `test`로 자동 설정하므로, 테스트에서는 로거가 silent로 떨어져 출력이 깨끗해야 한다.

Run: `pnpm --filter @daily/api test`
Expected: PASS — 4 tests

- [ ] **Step 6: 커밋**

```bash
git add apps/api
git commit -m "feat: Fastify 앱 스캐폴딩과 전역 에러 핸들러"
```

---

## Task 4: DB 연결과 인증 테이블

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/pool.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/time.ts`
- Create: `apps/api/src/db/testing.ts`
- Test: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `env` (Task 3)
- Produces: `db` (drizzle 인스턴스), `pool`, 테이블 객체 `users`/`refreshTokens`/`passwordResetTokens`/`loginAttempts`, `dbNow(): string` (KST 벽시계 문자열), `resetDb(): Promise<void>` (테스트 전용)

- [ ] **Step 1: 패키지 설치**

```bash
pnpm --filter @daily/api add drizzle-orm pg
pnpm --filter @daily/api add -D drizzle-kit @types/pg
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/api/src/db/schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { users } from './schema.ts'
import { dbNow } from './time.ts'
import { resetDb } from './testing.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('users 테이블', () => {
  it('사용자를 저장하고 조회한다', async () => {
    const now = dbNow()
    const [inserted] = await db.insert(users).values({
      email: 'a@example.com',
      passwordHash: 'hash',
      status: 'ACTIVE',
      createdAt: now,
      createdBy: 0,
      updatedAt: now,
      updatedBy: 0,
    }).returning()

    expect(inserted?.id).toBeGreaterThan(0)

    const found = await db.select().from(users).where(eq(users.email, 'a@example.com'))
    expect(found).toHaveLength(1)
    expect(found[0]?.status).toBe('ACTIVE')
  })

  it('시각 컬럼은 KST 벽시계 문자열로 저장된다', async () => {
    const now = dbNow()
    await db.insert(users).values({
      email: 'b@example.com', passwordHash: 'h', status: 'ACTIVE',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })

    const [row] = await db.select().from(users).where(eq(users.email, 'b@example.com'))
    // 타임존 접미사 없이 원문 그대로 돌아와야 한다
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(row?.createdAt).not.toContain('Z')
    expect(row?.createdAt).not.toContain('+')
  })

  it('이메일은 중복될 수 없다', async () => {
    const now = dbNow()
    const values = {
      email: 'dup@example.com', passwordHash: 'h', status: 'ACTIVE' as const,
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    }
    await db.insert(users).values(values)
    await expect(db.insert(users).values(values)).rejects.toThrow()
  })
})
```

두 번째 테스트가 이 프로젝트에서 가장 새기 쉬운 버그를 막는다. **node-postgres는 기본적으로 `timestamp` 컬럼을 서버 로컬 타임존의 `Date`로 해석해버려서, 저장한 KST 벽시계 값이 읽을 때 조용히 틀어진다.**

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @daily/api test schema`
Expected: FAIL — `Failed to resolve import "./pool.ts"`

- [ ] **Step 4: 구현**

`apps/api/src/db/pool.ts`:

```ts
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

// TIMESTAMP(1114)와 DATE(1082)를 Date로 변환하지 않고 원문 문자열로 받는다.
// 변환을 허용하면 노드 프로세스의 로컬 타임존이 끼어들어 KST 벽시계 값이 틀어진다.
pg.types.setTypeParser(1114, (v: string) => v)
pg.types.setTypeParser(1082, (v: string) => v)

// 테스트에서는 반드시 테스트 DB로만 붙는다. 폴백을 두지 않는 이유:
// Vitest가 NODE_ENV=test를 자동 설정하므로, DATABASE_URL_TEST가 비어 있을 때
// 개발 DB로 흘러가면 resetDb()의 TRUNCATE가 개발 데이터를 날린다.
// env 스키마가 test 환경에서 이 값을 필수로 강제하므로 여기서는 단정해도 된다.
export const connectionString =
  env.NODE_ENV === 'test' ? env.DATABASE_URL_TEST! : env.DATABASE_URL

export const pool = new pg.Pool({ connectionString, max: 10 })
export const db = drizzle(pool, { schema })
```

`apps/api/src/db/time.ts`:

```ts
import { toKstTimestamp } from '@daily/shared'

/** 현재 시각을 DB 저장용 KST 벽시계 문자열로 반환한다. */
export function dbNow(): string {
  return toKstTimestamp(new Date())
}
```

`apps/api/src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  bigint, bigserial, check, index, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core'

/** 모든 테이블이 공유하는 감사 컬럼. `_at`에는 반드시 `_by`가 따라붙는다. */
const auditColumns = {
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  createdBy: bigint('created_by', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
  updatedBy: bigint('updated_by', { mode: 'number' }).notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  deletedBy: bigint('deleted_by', { mode: 'number' }),
}

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { mode: 'string' }),
  emailVerifiedBy: bigint('email_verified_by', { mode: 'number' }),
  status: text('status').notNull().default('ACTIVE'),
  deletionRequestedAt: timestamp('deletion_requested_at', { mode: 'string' }),
  deletionRequestedBy: bigint('deletion_requested_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [
  uniqueIndex('users_email_uq').on(t.email),
  // 코드성 데이터는 DB와 애플리케이션 양쪽에서 막는다.
  check('users_status_ck', sql`${t.status} IN ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION')`),
])

export const refreshTokens = pgTable('refresh_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
  /** 폐기한 주체. 사용자 로그아웃과 재사용 탐지에 의한 시스템 폐기(0)를 구분한다 */
  revokedBy: bigint('revoked_by', { mode: 'number' }),
  /** 로테이션 체인 추적 — 이 토큰이 어떤 토큰을 대체했는지 */
  replacedBy: bigint('replaced_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [
  uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
  index('refresh_tokens_user_idx').on(t.userId),
])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'string' }),
  usedBy: bigint('used_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash)])

/**
 * 인증 '전' 이벤트를 기록하므로 감사 컬럼(`_by`)을 갖지 않는다.
 * 없는 계정으로 시도한 경우 행위자 ID가 존재하지 않기 때문이다. 대신 email과 ip를 남긴다.
 */
export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  ip: text('ip').notNull(),
  succeeded: text('succeeded').notNull(), // 'Y' | 'N'
  attemptedAt: timestamp('attempted_at', { mode: 'string' }).notNull(),
}, (t) => [
  index('login_attempts_email_idx').on(t.email, t.attemptedAt),
  check('login_attempts_succeeded_ck', sql`${t.succeeded} IN ('Y', 'N')`),
])
```

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'
import { env } from './src/env.ts'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: env.DATABASE_URL },
})
```

`apps/api/src/db/testing.ts`:

```ts
import { sql } from 'drizzle-orm'
import { connectionString, db } from './pool.ts'
import { env } from '../env.ts'

/** 테스트 DB의 모든 테이블을 비운다. 운영 DB에서는 절대 실행되지 않는다. */
export async function resetDb(): Promise<void> {
  if (env.NODE_ENV !== 'test') {
    throw new Error('resetDb는 테스트 환경에서만 실행할 수 있습니다.')
  }
  // NODE_ENV만 믿지 않는다. 실제로 붙어 있는 대상이 개발 DB면 멈춘다.
  // 이 두 겹이 있어야 환경변수 하나가 잘못돼도 개발 데이터가 날아가지 않는다.
  if (connectionString === env.DATABASE_URL) {
    throw new Error('resetDb가 개발 DB를 가리키고 있습니다. DATABASE_URL_TEST를 확인하세요.')
  }
  await db.execute(sql`
    TRUNCATE TABLE login_attempts, password_reset_tokens, refresh_tokens, users
    RESTART IDENTITY CASCADE
  `)
}
```

- [ ] **Step 5: 마이그레이션 생성과 적용**

`apps/api/package.json`의 `scripts`에 추가:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

로컬 개발 DB는 저장소 루트의 `docker-compose.yml`로 띄운다. `daily`와 `daily_test`는 이미 만들어져 있으므로 `createdb`를 다시 실행하지 않는다.

```bash
docker compose up -d --wait        # 이미 떠 있으면 생략

pnpm --filter @daily/api db:generate
pnpm --filter @daily/api db:migrate
DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @daily/api db:migrate
```

마지막 줄이 필요한 이유: `drizzle.config.ts`는 `DATABASE_URL`만 보므로, 테스트 DB에는 환경변수를 갈아끼워 한 번 더 적용해야 한다. 이걸 빼면 통합 테스트가 "relation does not exist"로 죽는다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test schema`
Expected: PASS — 3 tests

- [ ] **Step 7: 커밋**

```bash
git add apps/api
git commit -m "feat: DB 연결과 인증 테이블 스키마"
```

---

## Task 5: 비밀번호 정책과 해싱

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Test: `apps/api/src/auth/password.test.ts`

**Interfaces:**
- Consumes: `AppError` (Task 3)
- Produces: `assertValidPassword(pw: string): void` (위반 시 `AppError` throw), `hashPassword(pw: string): Promise<string>`, `verifyPassword(hash: string, pw: string): Promise<boolean>`

- [ ] **Step 1: 패키지 설치**

```bash
pnpm --filter @daily/api add argon2
```

argon2는 네이티브 애드온이라 pnpm이 기본적으로 설치 스크립트를 막는다. `pnpm-workspace.yaml`에 아래를 더해 허용한다 — 프리빌트 바이너리를 내려받는 용도이고, 소스 컴파일이 아니다.

```yaml
onlyBuiltDependencies:
  - argon2
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/api/src/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertValidPassword, hashPassword, verifyPassword } from './password.ts'
import { AppError } from '../errors.ts'

describe('비밀번호 정책', () => {
  it('10자 미만은 거부한다', () => {
    expect(() => assertValidPassword('short123')).toThrow(AppError)
  })

  it('128자 초과는 거부한다', () => {
    expect(() => assertValidPassword('a'.repeat(129))).toThrow(AppError)
  })

  it('흔한 비밀번호는 거부한다', () => {
    expect(() => assertValidPassword('password123')).toThrow(AppError)
    expect(() => assertValidPassword('qwerty123456')).toThrow(AppError)
  })

  it('대소문자를 구분하지 않고 블랙리스트를 적용한다', () => {
    expect(() => assertValidPassword('Password123')).toThrow(AppError)
  })

  it('특수문자를 요구하지 않는다', () => {
    expect(() => assertValidPassword('여름밤의 산책 기록')).not.toThrow()
  })
})

describe('해싱', () => {
  it('해시는 원문을 포함하지 않는다', async () => {
    const hash = await hashPassword('나의 긴 비밀번호 문장')
    expect(hash).not.toContain('나의 긴 비밀번호 문장')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('같은 비밀번호도 매번 다른 해시가 나온다', async () => {
    const a = await hashPassword('나의 긴 비밀번호 문장')
    const b = await hashPassword('나의 긴 비밀번호 문장')
    expect(a).not.toBe(b)
  })

  it('올바른 비밀번호만 검증에 통과한다', async () => {
    const hash = await hashPassword('나의 긴 비밀번호 문장')
    expect(await verifyPassword(hash, '나의 긴 비밀번호 문장')).toBe(true)
    expect(await verifyPassword(hash, '틀린 비밀번호 문장입니다')).toBe(false)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @daily/api test password`
Expected: FAIL — `Failed to resolve import "./password.ts"`

- [ ] **Step 4: 구현**

`apps/api/src/auth/password.ts`:

```ts
import argon2 from 'argon2'
import { AppError } from '../errors.ts'

const MIN_LENGTH = 10
const MAX_LENGTH = 128

/**
 * 자주 쓰이는 비밀번호 목록. 복잡도를 강제하는 대신 이쪽을 막는다.
 * 특수문자 강제는 'Password1!' 같은 예측 가능한 패턴만 양산한다(NIST 권고).
 */
const BLOCKLIST = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'qwerty123456', 'qwertyuiop', '1234567890', '12345678901',
  'iloveyou123', 'admin12345', 'letmein123', 'welcome123',
  'abcd123456', 'p@ssw0rd12',
])

export function assertValidPassword(pw: string): void {
  if (pw.length < MIN_LENGTH) {
    throw new AppError(400, 'PASSWORD_TOO_SHORT', `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`)
  }
  if (pw.length > MAX_LENGTH) {
    throw new AppError(400, 'PASSWORD_TOO_LONG', `비밀번호는 ${MAX_LENGTH}자 이하여야 합니다.`)
  }
  if (BLOCKLIST.has(pw.toLowerCase())) {
    throw new AppError(400, 'PASSWORD_TOO_COMMON', '너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해주세요.')
  }
}

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  // 예외를 삼키지 않는다. argon2.verify가 던지는 경우는 저장된 해시가 깨졌거나
  // 네이티브 바인딩이 실패한 때뿐이고, 둘 다 "비밀번호가 틀렸다"가 아니라
  // 서버 장애다. false로 뭉개면 운영자는 사용자의 오타와 데이터 손상을
  // 구분할 수 없다. 전역 에러 핸들러가 500으로 변환하고 전문을 로깅한다.
  return argon2.verify(hash, pw)
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @daily/api test password`
Expected: PASS — 8 tests

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/auth
git commit -m "feat: 비밀번호 정책 검증과 argon2 해싱"
```

---

## Task 6: 토큰 발급과 검증

**Files:**
- Create: `apps/api/src/auth/tokens.ts`
- Test: `apps/api/src/auth/tokens.test.ts`

**Interfaces:**
- Consumes: `env` (Task 3), `db`/`refreshTokens`/`dbNow` (Task 4)
- Produces:
  - `issueAccessToken(userId: number): Promise<string>`
  - `verifyAccessToken(token: string): Promise<number>` — userId 반환, 실패 시 `AppError(401, 'INVALID_TOKEN')`
  - `issueRefreshToken(userId: number): Promise<string>` — 평문 토큰 반환, DB에는 해시 저장
  - `rotateRefreshToken(raw: string): Promise<{ userId: number; token: string }>` — 재사용 탐지 포함
  - `revokeRefreshToken(raw: string): Promise<void>`
  - `REFRESH_COOKIE_NAME: 'daily_rt'`

- [ ] **Step 1: 패키지 설치**

```bash
pnpm --filter @daily/api add jose
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/api/src/auth/tokens.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/pool.ts'
import { refreshTokens, users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { resetDb } from '../db/testing.ts'
import { AppError } from '../errors.ts'
import {
  issueAccessToken, issueRefreshToken, revokeRefreshToken,
  rotateRefreshToken, verifyAccessToken,
} from './tokens.ts'

async function createUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('액세스 토큰', () => {
  it('발급한 토큰에서 userId를 되찾는다', async () => {
    const token = await issueAccessToken(42)
    expect(await verifyAccessToken(token)).toBe(42)
  })

  it('위조된 토큰은 거부한다', async () => {
    const token = await issueAccessToken(42)
    const tampered = `${token.slice(0, -3)}abc`
    await expect(verifyAccessToken(tampered)).rejects.toThrow(AppError)
  })
})

describe('리프레시 토큰', () => {
  it('평문 토큰은 DB에 저장되지 않는다', async () => {
    const userId = await createUser('a@example.com')
    const raw = await issueRefreshToken(userId)

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).not.toBe(raw)
    expect(rows[0]?.tokenHash).toHaveLength(64) // sha256 hex
  })

  it('로테이션하면 새 토큰이 나오고 이전 토큰은 폐기된다', async () => {
    const userId = await createUser('b@example.com')
    const first = await issueRefreshToken(userId)

    const rotated = await rotateRefreshToken(first)
    expect(rotated.userId).toBe(userId)
    expect(rotated.token).not.toBe(first)

    // 이전 토큰으로는 더 이상 로테이션할 수 없다
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)
  })

  it('폐기된 토큰이 재사용되면 해당 사용자의 모든 토큰을 무효화한다', async () => {
    const userId = await createUser('c@example.com')
    const first = await issueRefreshToken(userId)
    const second = await rotateRefreshToken(first)

    // 탈취된 옛 토큰이 다시 들어온 상황
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)

    // 정상 사용자가 들고 있던 최신 토큰도 함께 무효화되어야 한다
    await expect(rotateRefreshToken(second.token)).rejects.toThrow(AppError)
  })

  it('알 수 없는 토큰은 거부한다', async () => {
    await expect(rotateRefreshToken('존재하지-않는-토큰')).rejects.toThrow(AppError)
  })

  it('폐기한 토큰으로는 로테이션할 수 없다', async () => {
    const userId = await createUser('d@example.com')
    const raw = await issueRefreshToken(userId)
    await revokeRefreshToken(raw)
    await expect(rotateRefreshToken(raw)).rejects.toThrow(AppError)
  })

  it('동시에 같은 토큰으로 로테이션하면 하나만 성공한다', async () => {
    const userId = await createUser('e@example.com')
    const raw = await issueRefreshToken(userId)

    const results = await Promise.allSettled([
      rotateRefreshToken(raw),
      rotateRefreshToken(raw),
    ])

    // 선점이 없으면 둘 다 성공하고 옛 토큰이 살아남는다 — 재사용 탐지가 무력화된다.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
})

describe('revoked_by 기록', () => {
  async function revokedByOf(raw: string): Promise<number | null> {
    const [row] = await db.select({ revokedBy: refreshTokens.revokedBy })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, createHash('sha256').update(raw).digest('hex')))
    return row?.revokedBy ?? null
  }

  it('로테이션으로 폐기하면 토큰 주인이 행위자로 남는다', async () => {
    const userId = await createUser('f@example.com')
    const raw = await issueRefreshToken(userId)
    await rotateRefreshToken(raw)
    expect(await revokedByOf(raw)).toBe(userId)
  })

  it('로그아웃으로 폐기하면 토큰 주인이 행위자로 남는다', async () => {
    const userId = await createUser('g@example.com')
    const raw = await issueRefreshToken(userId)
    await revokeRefreshToken(raw)
    expect(await revokedByOf(raw)).toBe(userId)
  })

  it('재사용 탐지로 강제 폐기하면 시스템 sentinel 0이 남는다', async () => {
    const userId = await createUser('h@example.com')
    const first = await issueRefreshToken(userId)
    const second = await rotateRefreshToken(first)

    // 탈취된 옛 토큰 재사용 → second가 강제 폐기된다
    await expect(rotateRefreshToken(first)).rejects.toThrow(AppError)

    expect(await revokedByOf(second.token)).toBe(0)
  })
})
```

마지막 세 테스트가 없으면 `revoked_by`는 코드에만 있고 아무도 지켜주지 않는다. 누군가 로그아웃 경로의 `sql` 자기 참조를 `0`이나 `null`로 "단순화"해도 빨간불이 켜지지 않는다.

동시성 테스트는 선점 방식이 실제로 경쟁을 막는지 직접 증명한다. 조회 후 갱신으로 되돌리면 두 요청이 모두 성공해서 이 테스트가 깨진다.

이 테스트 블록은 `createHash`(`node:crypto`)와 `refreshTokens`(`../db/schema.ts`)를 추가로 import한다.

네 번째 테스트가 재사용 탐지의 핵심이다. **탈취된 토큰이 쓰이면 공격자와 정상 사용자를 구분할 수 없으므로 양쪽 다 끊고 재로그인시키는 것이 유일하게 안전한 선택이다.**

- [ ] **Step 3: 테스트 실패 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test tokens`
Expected: FAIL — `Failed to resolve import "./tokens.ts"`

- [ ] **Step 4: 구현**

`apps/api/src/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { toKstTimestamp } from '@daily/shared'
import { db } from '../db/pool.ts'
import { refreshTokens } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { env } from '../env.ts'
import { AppError } from '../errors.ts'

export const REFRESH_COOKIE_NAME = 'daily_rt'

const secret = new TextEncoder().encode(env.JWT_SECRET)

export async function issueAccessToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<number> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError(401, 'INVALID_TOKEN', '인증 정보가 올바르지 않습니다.')
    }
    return userId
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(401, 'INVALID_TOKEN', '인증 정보가 올바르지 않습니다.')
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function expiryTimestamp(): string {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  return toKstTimestamp(new Date(Date.now() + ms))
}

export async function issueRefreshToken(userId: number): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  const now = dbNow()
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: expiryTimestamp(),
    createdAt: now, createdBy: userId, updatedAt: now, updatedBy: userId,
  })
  return raw
}

/** 해당 사용자의 살아 있는 리프레시 토큰을 전부 폐기한다. */
async function revokeAllForUser(userId: number): Promise<void> {
  const now = dbNow()
  await db.update(refreshTokens)
    // 재사용 탐지에 의한 강제 폐기는 시스템 행위다. sentinel 0을 남겨
    // 사용자가 스스로 로그아웃한 경우와 구분한다.
    .set({ revokedAt: now, revokedBy: 0, updatedAt: now, updatedBy: userId })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
}

export async function rotateRefreshToken(
  raw: string,
): Promise<{ userId: number; token: string }> {
  const hash = hashToken(raw)
  const now = dbNow()

  // 살아 있는 토큰을 UPDATE 한 번으로 선점한다.
  //
  // 조회 후 갱신으로 나누면 TOCTOU가 생긴다. 같은 옛 토큰을 든 요청 두 개가
  // 동시에 들어오면 둘 다 `revoked_at IS NULL`을 읽고 각자 새 토큰을 발급받으며,
  // 옛 토큰은 살아남는다. 재사용 탐지는 아무것도 감지하지 못한다 — 이 태스크가
  // 제공하기로 한 바로 그 보장이 조용히 사라진다.
  // `WHERE revoked_at IS NULL`을 UPDATE에 넣으면 경쟁에서 정확히 하나만 이긴다.
  const [claimed] = await db.update(refreshTokens)
    .set({
      revokedAt: now,
      revokedBy: sql`${refreshTokens.userId}`,
      updatedAt: now,
      updatedBy: sql`${refreshTokens.userId}`,
    })
    .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
    .returning()

  if (!claimed) {
    // 선점 실패 — 없는 토큰이거나 이미 폐기된 토큰이다. 둘을 구분해야 한다.
    const [existing] = await db.select().from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))

    if (!existing) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    // 폐기된 토큰이 다시 들어왔다 = 탈취 가능성.
    // 공격자와 정상 사용자를 구분할 수 없으므로 양쪽 다 끊는다.
    await revokeAllForUser(existing.userId)
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', '보안을 위해 로그아웃되었습니다. 다시 로그인해주세요.')
  }

  // 만료 검사는 선점 뒤에 한다. 만료된 토큰이 폐기 처리되는 건 문제가 아니다.
  if (claimed.expiresAt <= now) {
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', '다시 로그인해주세요.')
  }

  const next = await issueRefreshToken(claimed.userId)
  const [nextRow] = await db.select({ id: refreshTokens.id }).from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(next)))

  await db.update(refreshTokens)
    .set({ replacedBy: nextRow?.id ?? null })
    .where(eq(refreshTokens.id, claimed.id))

  return { userId: claimed.userId, token: next }
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  const now = dbNow()
  await db.update(refreshTokens)
    // 로그아웃은 토큰 주인의 행위이므로 그 행의 user_id를 그대로 행위자로 남긴다.
    .set({
      revokedAt: now, revokedBy: sql`${refreshTokens.userId}`,
      updatedAt: now, updatedBy: sql`${refreshTokens.userId}`,
    })
    .where(and(
      eq(refreshTokens.tokenHash, hashToken(raw)),
      isNull(refreshTokens.revokedAt),
    ))
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test tokens`
Expected: PASS — 8 tests

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/auth
git commit -m "feat: 액세스/리프레시 토큰 발급과 재사용 탐지"
```

---

## Task 7: 로그인 실패 스로틀

**Files:**
- Create: `apps/api/src/auth/throttle.ts`
- Test: `apps/api/src/auth/throttle.test.ts`

**Interfaces:**
- Consumes: `db`/`loginAttempts`/`dbNow` (Task 4)
- Produces: `recordAttempt(email: string, ip: string, succeeded: boolean): Promise<void>`, `loginDelayMs(email: string): Promise<number>`

계정 잠금 대신 지수 지연을 쓴다. **잠금은 공격자가 남의 이메일로 일부러 실패시켜 계정을 잠글 수 있어 방어가 아니라 서비스 거부 수단이 된다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/api/src/auth/throttle.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/pool.ts'
import { resetDb } from '../db/testing.ts'
import { loginDelayMs, recordAttempt } from './throttle.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

describe('로그인 실패 지연', () => {
  it('실패 이력이 없으면 지연이 없다', async () => {
    expect(await loginDelayMs('a@example.com')).toBe(0)
  })

  it('실패가 쌓일수록 지연이 두 배씩 늘어난다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(1000)

    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(2000)

    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('a@example.com')).toBe(4000)
  })

  it('지연에 상한이 있다', async () => {
    for (let i = 0; i < 20; i += 1) {
      await recordAttempt('a@example.com', '1.1.1.1', false)
    }
    expect(await loginDelayMs('a@example.com')).toBe(30_000)
  })

  it('성공하면 지연이 초기화된다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', true)
    expect(await loginDelayMs('a@example.com')).toBe(0)
  })

  it('다른 계정의 실패는 영향을 주지 않는다', async () => {
    await recordAttempt('a@example.com', '1.1.1.1', false)
    await recordAttempt('a@example.com', '1.1.1.1', false)
    expect(await loginDelayMs('b@example.com')).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test throttle`
Expected: FAIL — `Failed to resolve import "./throttle.ts"`

- [ ] **Step 3: 구현**

`apps/api/src/auth/throttle.ts`:

```ts
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/pool.ts'
import { loginAttempts } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const LOOKBACK = 20

export async function recordAttempt(
  email: string,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({
    email: email.toLowerCase(),
    ip,
    succeeded: succeeded ? 'Y' : 'N',
    attemptedAt: dbNow(),
  })
}

/** 마지막 성공 이후 연속 실패 횟수에 따라 지연 시간을 계산한다. */
export async function loginDelayMs(email: string): Promise<number> {
  const rows = await db.select({ succeeded: loginAttempts.succeeded })
    .from(loginAttempts)
    .where(eq(loginAttempts.email, email.toLowerCase()))
    .orderBy(desc(loginAttempts.attemptedAt), desc(loginAttempts.id))
    .limit(LOOKBACK)

  let consecutiveFailures = 0
  for (const row of rows) {
    if (row.succeeded === 'Y') break
    consecutiveFailures += 1
  }

  if (consecutiveFailures === 0) return 0
  return Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test throttle`
Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/auth
git commit -m "feat: 로그인 실패 지수 지연"
```

---

## Task 8: 인증 라우트

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: 비밀번호 유틸(Task 5), 토큰 유틸(Task 6), 스로틀(Task 7)
- Produces: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`. shared에 `registerSchema`, `loginSchema`, 타입 `AuthResponse = { accessToken: string; user: { id: number; email: string } }`

- [ ] **Step 1: shared에 인증 스키마 추가**

`packages/shared/src/auth.ts`:

```ts
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
```

`packages/shared/src/index.ts`에 `export * from './auth.ts'` 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/api/src/routes/auth.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.ts'
import { pool } from '../db/pool.ts'
import { resetDb } from '../db/testing.ts'
import { REFRESH_COOKIE_NAME } from '../auth/tokens.ts'

let app: FastifyInstance

beforeAll(async () => { app = await buildApp(); await app.ready() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await app.close(); await pool.end() })

const CREDENTIALS = { email: 'user@example.com', password: '충분히 긴 비밀번호' }

function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  if (!cookie) throw new Error('리프레시 쿠키가 없습니다')
  return cookie.value
}

describe('POST /api/auth/register', () => {
  it('가입에 성공하면 액세스 토큰과 리프레시 쿠키를 준다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })

    expect(res.statusCode).toBe(201)
    expect(res.json().accessToken).toBeTruthy()
    expect(res.json().user.email).toBe('user@example.com')
    expect(res.json().user.passwordHash).toBeUndefined()

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
  })

  it('이메일 대소문자를 구분하지 않고 중복을 막는다', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { ...CREDENTIALS, email: 'USER@example.com' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('EMAIL_ALREADY_EXISTS')
  })

  it('짧은 비밀번호는 거부한다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { email: 'a@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: CREDENTIALS })
  })

  it('올바른 자격증명으로 로그인한다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: CREDENTIALS })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
  })

  it('틀린 비밀번호와 없는 계정의 응답이 구분되지 않는다', async () => {
    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { ...CREDENTIALS, password: '틀린 비밀번호입니다' },
    })
    const noAccount = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: '아무 비밀번호나 입력' },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(noAccount.statusCode).toBe(401)
    expect(wrongPassword.json().error.code).toBe(noAccount.json().error.code)
    expect(wrongPassword.json().error.message).toBe(noAccount.json().error.message)
  })
})

describe('POST /api/auth/refresh', () => {
  it('쿠키로 새 액세스 토큰과 새 리프레시 쿠키를 받는다', async () => {
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: CREDENTIALS,
    })
    const first = refreshCookie(registered)

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: first },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
    expect(refreshCookie(res)).not.toBe(first)
  })

  it('쿠키가 없으면 401을 반환한다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('로그아웃하면 리프레시 토큰이 폐기되고 쿠키가 지워진다', async () => {
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: CREDENTIALS,
    })
    const token = refreshCookie(registered)

    const res = await app.inject({
      method: 'POST', url: '/api/auth/logout',
      cookies: { [REFRESH_COOKIE_NAME]: token },
    })
    expect(res.statusCode).toBe(204)

    const reused = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: token },
    })
    expect(reused.statusCode).toBe(401)
  })
})
```

두 번째 로그인 테스트가 **계정 열거 공격 방지**를 회귀 테스트로 고정한다. 상태코드·code·message가 모두 같아야 한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test auth`
Expected: FAIL — `Failed to resolve import "../routes/auth.ts"`

- [ ] **Step 4: 구현**

`apps/api/src/routes/auth.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { loginSchema, registerSchema, type AuthResponse } from '@daily/shared'
import { db } from '../db/pool.ts'
import { users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { env } from '../env.ts'
import { AppError } from '../errors.ts'
import { assertValidPassword, hashPassword, verifyPassword } from '../auth/password.ts'
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
    const input = registerSchema.parse(req.body)
    const email = input.email.toLowerCase()
    assertValidPassword(input.password)

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    if (existing.length > 0) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.')
    }

    const now = dbNow()
    const [created] = await db.insert(users).values({
      email,
      passwordHash: await hashPassword(input.password),
      status: 'ACTIVE',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    }).returning({ id: users.id, email: users.email })

    const userId = created!.id
    // 생성자 자신을 감사 컬럼에 반영한다.
    await db.update(users)
      .set({ createdBy: userId, updatedBy: userId })
      .where(eq(users.id, userId))

    setRefreshCookie(reply, await issueRefreshToken(userId))
    const body: AuthResponse = {
      accessToken: await issueAccessToken(userId),
      user: { id: userId, email: created!.email },
    }
    return reply.status(201).send(body)
  })

  app.post('/auth/login', async (req, reply) => {
    const input = loginSchema.parse(req.body)
    const email = input.email.toLowerCase()
    const ip = req.ip

    await sleep(await loginDelayMs(email))

    const [user] = await db.select().from(users).where(eq(users.email, email))
    const ok = user !== undefined
      && user.status === 'ACTIVE'
      && user.deletedAt === null
      && await verifyPassword(user.passwordHash, input.password)

    if (!ok) {
      await recordAttempt(email, ip, false)
      // 계정 존재 여부를 응답으로 구분하지 않는다.
      throw new AppError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.')
    }

    await recordAttempt(email, ip, true)
    setRefreshCookie(reply, await issueRefreshToken(user.id))
    const body: AuthResponse = {
      accessToken: await issueAccessToken(user.id),
      user: { id: user.id, email: user.email },
    }
    return reply.status(200).send(body)
  })

  app.post('/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE_NAME]
    if (!raw) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    const { userId, token } = await rotateRefreshToken(raw)
    const [user] = await db.select({ id: users.id, email: users.email })
      .from(users).where(eq(users.id, userId))
    if (!user) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '다시 로그인해주세요.')
    }

    setRefreshCookie(reply, token)
    const body: AuthResponse = {
      accessToken: await issueAccessToken(userId),
      user: { id: user.id, email: user.email },
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
```

`apps/api/src/app.ts`에 라우트 등록 추가 (`healthRoutes` 등록 아래):

```ts
import { authRoutes } from './routes/auth.ts'
// ...
await app.register(authRoutes, { prefix: '/api' })
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test`
Expected: PASS — 전체 통과 (auth 8 tests 포함)

- [ ] **Step 6: 커밋**

```bash
git add apps/api packages/shared
git commit -m "feat: 회원가입/로그인/리프레시/로그아웃 라우트"
```

---

## Task 9: 인증 미들웨어와 rate limit

**Files:**
- Create: `apps/api/src/plugins/require-auth.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/plugins/require-auth.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 6)
- Produces: `requireAuth` (Fastify `preHandler` 훅), `FastifyRequest.userId: number` 타입 확장

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/api/src/plugins/require-auth.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.ts'
import { pool } from '../db/pool.ts'
import { issueAccessToken } from '../auth/tokens.ts'
import { requireAuth } from './require-auth.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  app.get('/protected', { preHandler: requireAuth }, async (req) => ({ userId: req.userId }))
  await app.ready()
})

afterAll(async () => { await app.close(); await pool.end() })

describe('requireAuth', () => {
  it('유효한 토큰이면 userId를 주입한다', async () => {
    const token = await issueAccessToken(7)
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: 7 })
  })

  it('토큰이 없으면 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('Bearer 형식이 아니면 401을 반환한다', async () => {
    const token = await issueAccessToken(7)
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { authorization: token },
    })
    expect(res.statusCode).toBe(401)
  })

  it('위조된 토큰은 401을 반환한다', async () => {
    const res = await app.inject({
      method: 'GET', url: '/protected',
      headers: { authorization: 'Bearer 아무렇게나.만든.토큰' },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test require-auth`
Expected: FAIL — `Failed to resolve import "./require-auth.ts"`

- [ ] **Step 3: 구현**

`apps/api/src/plugins/require-auth.ts`:

```ts
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
```

`apps/api/src/app.ts`에 rate limit 등록 추가 (`cookie` 등록 아래):

```ts
import rateLimit from '@fastify/rate-limit'
// ...
await app.register(rateLimit, {
  max: env.NODE_ENV === 'test' ? 10_000 : 300,
  timeWindow: '1 minute',
})
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `NODE_ENV=test pnpm --filter @daily/api test`
Expected: PASS — 전체 통과

- [ ] **Step 5: 커밋**

```bash
git add apps/api
git commit -m "feat: 인증 미들웨어와 rate limit"
```

---

## Task 10: 웹 스캐폴딩과 Dexie 스키마

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/postcss.config.js`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`
- Create: `apps/web/src/db/index.ts`
- Test: `apps/web/src/db/index.test.ts`

**Interfaces:**
- Consumes: `@daily/shared` 코드값·타입
- Produces: `db` (Dexie 인스턴스), 타입 `OutboxRow { seq: number; table: string; clientUuid: string; op: OutboxOp; payload: unknown; updatedAt: string; tryCount: number; lastError: string | null; queuedAt: string }`, `MetaRow { key: string; value: string }`

이 태스크에서는 **Dexie 스키마와 아웃박스 테이블만 만든다.** 동기화 엔진과 도메인 테이블은 2단계에서 붙인다.

- [ ] **Step 1: 패키지 설치와 설정**

```bash
pnpm --filter @daily/web add react react-dom dexie dexie-react-hooks zustand react-router
pnpm --filter @daily/web add -D vite @vitejs/plugin-react typescript tailwindcss @tailwindcss/postcss postcss vite-plugin-pwa vitest jsdom fake-indexeddb @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom
```

`apps/web/package.json`:

```json
{
  "name": "@daily/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@daily/shared": "workspace:*" }
}
```

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Daily',
        short_name: 'Daily',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111827',
      },
    }),
  ],
  server: {
    // 개발 중에는 프론트(5173)와 API(3001)가 분리되어 있으므로 프록시로 같은 출처를 만든다.
    // 이렇게 해야 리프레시 쿠키(SameSite=Strict)가 개발 환경에서도 동작한다.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
})
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

`apps/web/src/test-setup.ts`:

```ts
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
```

`apps/web/postcss.config.js`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`apps/web/src/index.css`:

```css
@import "tailwindcss";
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Daily</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/web/src/db/index.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index.ts'

beforeEach(async () => {
  await db.outbox.clear()
  await db.meta.clear()
})

describe('로컬 DB', () => {
  it('아웃박스에 항목을 넣으면 seq가 증가한다', async () => {
    const first = await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-1', op: 'UPSERT',
      payload: { amount: '1000' }, updatedAt: '2026-08-06 10:00:00.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:00.000',
    })
    const second = await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-2', op: 'DELETE',
      payload: null, updatedAt: '2026-08-06 10:00:01.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:01.000',
    })

    expect(second).toBeGreaterThan(first)
  })

  it('clientUuid로 아웃박스 항목을 찾는다', async () => {
    await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-1', op: 'UPSERT',
      payload: {}, updatedAt: '2026-08-06 10:00:00.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:00.000',
    })

    const found = await db.outbox.where('clientUuid').equals('uuid-1').toArray()
    expect(found).toHaveLength(1)
    expect(found[0]?.op).toBe('UPSERT')
  })

  it('meta는 key로 값을 저장하고 읽는다', async () => {
    await db.meta.put({ key: 'lastPulledSyncedAt', value: '2026-08-06 09:00:00.000' })
    const row = await db.meta.get('lastPulledSyncedAt')
    expect(row?.value).toBe('2026-08-06 09:00:00.000')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @daily/web test`
Expected: FAIL — `Failed to resolve import "./index.ts"`

- [ ] **Step 4: 구현**

`apps/web/src/db/index.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie'
import type { OutboxOp } from '@daily/shared'

export interface OutboxRow {
  /**
   * 자동 증가 기본키. **옵셔널로 선언하지 않는다.**
   * Dexie의 `EntityTable<T, 'seq'>`는 키 타입을 `T['seq']`에서 뽑으므로,
   * `seq?: number`로 두면 `add()`의 반환 타입이 `number | undefined`가 된다.
   * 필수로 선언해도 `InsertType`이 삽입 시점에만 옵셔널로 바꿔주므로
   * `add({ ... })`에서 `seq`를 생략하는 코드는 그대로 컴파일된다.
   */
  seq: number
  /** 서버 테이블명 (예: 'expenses') */
  table: string
  clientUuid: string
  op: OutboxOp
  payload: unknown
  /** KST 벽시계 문자열 */
  updatedAt: string
  tryCount: number
  lastError: string | null
  queuedAt: string
}

export interface MetaRow {
  key: string
  value: string
}

class DailyDb extends Dexie {
  outbox!: EntityTable<OutboxRow, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('daily')
    // 도메인 테이블은 2단계에서 버전 2로 추가한다.
    this.version(1).stores({
      outbox: '++seq, clientUuid, table',
      meta: 'key',
    })
  }
}

export const db = new DailyDb()
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`apps/web/src/App.tsx` (Task 11에서 라우팅으로 대체됨):

```tsx
export default function App() {
  return <div className="p-4">Daily</div>
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @daily/web test`
Expected: PASS — 3 tests

- [ ] **Step 6: 커밋**

```bash
git add apps/web
git commit -m "feat: 웹 스캐폴딩과 Dexie 아웃박스 스키마"
```

---

## Task 11: API 클라이언트와 인증 화면

**Files:**
- Create: `apps/web/src/lib/apiClient.ts`
- Create: `apps/web/src/store/session.ts`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/RegisterPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/lib/apiClient.test.ts`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `AuthResponse`, `registerSchema`, `loginSchema` (Task 8)
- Produces:
  - `setAccessToken(t: string | null): void`, `apiFetch(path: string, init?: RequestInit): Promise<Response>` — 401 시 `/api/auth/refresh` 1회 시도 후 재요청
  - `useSession()` Zustand 스토어: `{ user, status: 'LOADING'|'AUTHENTICATED'|'ANONYMOUS', init(), login(email, password), register(email, password), logout() }`

액세스 토큰은 **메모리에만** 둔다. `localStorage`에 저장하지 않는다 — XSS가 뚫리면 그대로 유출된다. 앱 시작 시 `/api/auth/refresh`로 조용히 복구한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/lib/apiClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setAccessToken } from './apiClient.ts'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken(null)
})
afterEach(() => { vi.unstubAllGlobals() })

const ok = (body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 })

describe('apiFetch', () => {
  it('액세스 토큰을 Authorization 헤더로 보낸다', async () => {
    setAccessToken('token-abc')
    fetchMock.mockResolvedValueOnce(ok())

    await apiFetch('/expenses')

    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-abc')
  })

  it('401을 받으면 refresh 후 한 번만 재시도한다', async () => {
    setAccessToken('expired')
    fetchMock
      .mockResolvedValueOnce(unauthorized())                       // 최초 요청
      .mockResolvedValueOnce(ok({ accessToken: 'fresh', user: { id: 1, email: 'a@b.c' } })) // refresh
      .mockResolvedValueOnce(ok({ data: 'ok' }))                   // 재요청

    const res = await apiFetch('/expenses')

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, retryInit] = fetchMock.mock.calls[2]!
    expect(new Headers(retryInit.headers).get('authorization')).toBe('Bearer fresh')
  })

  it('refresh도 실패하면 재시도하지 않고 401을 그대로 돌려준다', async () => {
    setAccessToken('expired')
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/expenses')

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refresh 요청 자체는 재시도 대상이 아니다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/auth/refresh', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('로그인 실패는 refresh를 시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.c', password: '틀린 비밀번호입니다' }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('회원가입 실패도 refresh를 시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())

    await apiFetch('/auth/register', { method: 'POST', body: '{}' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

마지막 세 테스트가 **인증 전 요청에 refresh가 끼어드는 것을 막는다.** 로그인 401은 "자격증명이 틀렸다"는 뜻인데 여기서 refresh를 시도하면, 같은 기기에 다른 계정의 리프레시 쿠키가 남아 있을 때 그 세션의 토큰이 조용히 들어앉는다. 화면은 로그인 실패인데 `apiClient`만 남의 토큰을 들고 있게 되고, 이후 요청이 전부 그 토큰으로 나간다.

`apps/web/src/pages/LoginPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import LoginPage from './LoginPage.tsx'
import { useSession } from '../store/session.ts'

describe('LoginPage', () => {
  it('이메일과 비밀번호를 입력해 로그인을 호출한다', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '충분히 긴 비밀번호')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(login).toHaveBeenCalledWith('user@example.com', '충분히 긴 비밀번호')
  })

  it('로그인 실패 시 에러 메시지를 보여준다', async () => {
    const login = vi.fn().mockRejectedValue(new Error('이메일 또는 비밀번호가 올바르지 않습니다.'))
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '틀린 비밀번호입니다')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않습니다.')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @daily/web test`
Expected: FAIL — `Failed to resolve import "./apiClient.ts"`

- [ ] **Step 3: apiClient 구현**

`apps/web/src/lib/apiClient.ts`:

```ts
const BASE = '/api'

/** 액세스 토큰은 메모리에만 둔다. localStorage에 저장하지 않는다. */
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

function withAuth(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return { ...init, headers, credentials: 'include' }
}

/** 리프레시 쿠키로 액세스 토큰을 재발급받는다. 성공하면 true. */
async function refresh(): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    accessToken = null
    return false
  }
  const body = (await res.json()) as { accessToken: string }
  accessToken = body.accessToken
  return true
}

/**
 * 인증 전 요청. 401이 나도 refresh를 시도하지 않는다.
 * 쿼리스트링이 붙을 수 있으므로 경로만 잘라서 정확히 비교한다.
 */
const PRE_AUTH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh'])

function pathnameOf(path: string): string {
  const q = path.indexOf('?')
  return q === -1 ? path : path.slice(0, q)
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, withAuth(init))

  // 인증 전 요청의 401은 "자격증명이 틀렸다"는 뜻이지 "토큰이 만료됐다"가 아니다.
  // 여기서 refresh를 시도하면, 같은 기기에 다른 계정의 리프레시 쿠키가 살아 있을 때
  // 그 세션의 액세스 토큰이 조용히 들어앉는다. 화면은 로그인 실패로 보이는데
  // apiClient만 남의 세션 토큰을 들고 있는 상태가 되고, 이후 요청이 그 토큰으로 나간다.
  if (res.status !== 401 || PRE_AUTH_PATHS.has(pathnameOf(path))) return res

  if (!(await refresh())) return res
  return fetch(`${BASE}${path}`, withAuth(init))
}
```

- [ ] **Step 4: 세션 스토어 구현**

`apps/web/src/store/session.ts`:

```ts
import { create } from 'zustand'
import type { AuthResponse } from '@daily/shared'
import { apiFetch, setAccessToken } from '../lib/apiClient.ts'

type SessionStatus = 'LOADING' | 'AUTHENTICATED' | 'ANONYMOUS'

interface SessionState {
  user: { id: number; email: string } | null
  status: SessionStatus
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

async function readError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as
    { error?: { message?: string } } | null
  return new Error(body?.error?.message ?? '요청을 처리하지 못했습니다.')
}

async function authenticate(
  path: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as AuthResponse
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  status: 'LOADING',

  init: async () => {
    const res = await apiFetch('/auth/refresh', { method: 'POST' })
    if (!res.ok) {
      set({ user: null, status: 'ANONYMOUS' })
      return
    }
    const body = (await res.json()) as AuthResponse
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  login: async (email, password) => {
    const body = await authenticate('/auth/login', email, password)
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  register: async (email, password) => {
    const body = await authenticate('/auth/register', email, password)
    setAccessToken(body.accessToken)
    set({ user: body.user, status: 'AUTHENTICATED' })
  },

  logout: async () => {
    await apiFetch('/auth/logout', { method: 'POST' })
    setAccessToken(null)
    set({ user: null, status: 'ANONYMOUS' })
  },
}))
```

- [ ] **Step 5: 화면 구현**

`apps/web/src/pages/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useSession } from '../store/session.ts'

export default function LoginPage() {
  const login = useSession((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">로그인</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">이메일</span>
          <input
            type="email" value={email} required autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">비밀번호</span>
          <input
            type="password" value={password} required autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit" disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          로그인
        </button>
      </form>

      <p className="text-sm text-gray-600">
        계정이 없으신가요? <Link to="/register" className="underline">회원가입</Link>
      </p>
    </main>
  )
}
```

`apps/web/src/pages/RegisterPage.tsx` — `LoginPage`와 같은 구조이며 다음만 다르다:

```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useSession } from '../store/session.ts'

export default function RegisterPage() {
  const register = useSession((s) => s.register)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await register(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">회원가입</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">이메일</span>
          <input
            type="email" value={email} required autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">비밀번호</span>
          <input
            type="password" value={password} required minLength={10}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <span className="text-xs text-gray-500">10자 이상 입력해주세요.</span>
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button
          type="submit" disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          가입하기
        </button>
      </form>

      <p className="text-sm text-gray-600">
        이미 계정이 있으신가요? <Link to="/login" className="underline">로그인</Link>
      </p>
    </main>
  )
}
```

`apps/web/src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import { useSession } from './store/session.ts'

function HomePage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  return (
    <main className="p-6">
      <p className="mb-4">{user?.email}</p>
      <button type="button" onClick={() => void logout()} className="underline">
        로그아웃
      </button>
    </main>
  )
}

export default function App() {
  const status = useSession((s) => s.status)
  const init = useSession((s) => s.init)

  useEffect(() => { void init() }, [init])

  if (status === 'LOADING') {
    return <main className="grid min-h-dvh place-items-center">불러오는 중…</main>
  }

  return (
    <BrowserRouter>
      <Routes>
        {status === 'AUTHENTICATED' ? (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter @daily/web test`
Expected: PASS — 9 tests (apiClient 4, LoginPage 2, db 3)

- [ ] **Step 7: 수동 확인**

터미널 두 개에서:

```bash
pnpm --filter @daily/api dev
pnpm --filter @daily/web dev
```

`http://localhost:5173/register`에서 가입 → 홈 화면 진입 → 새로고침해도 로그인이 유지되는지(리프레시 쿠키 복구) → 로그아웃 확인.

- [ ] **Step 8: 커밋**

```bash
git add apps/web
git commit -m "feat: API 클라이언트와 로그인/회원가입 화면"
```

---

## Task 12: 배포 구성

**Files:**
- Create: `apps/api/ecosystem.config.cjs`
- Create: `deploy/nginx.conf.example`
- Create: `docs/deployment.md`
- Modify: `package.json` (루트 스크립트)

**Interfaces:**
- Consumes: 앞선 모든 태스크의 빌드 산출물
- Produces: 없음 (운영 문서·설정)

- [ ] **Step 1: PM2 설정 작성**

`apps/api/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: 'daily-api',
      script: 'node_modules/.bin/tsx',
      args: 'src/main.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      time: true,
    },
  ],
}
```

- [ ] **Step 2: nginx 설정 예시 작성**

`deploy/nginx.conf.example`:

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    root /var/www/daily/current;
    index index.html;

    # SPA — 정적 파일이 없으면 index.html로 폴백
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Service Worker는 캐시하지 않는다. 캐시하면 구버전 앱이 갱신되지 않는다.
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 해시가 붙은 빌드 산출물은 오래 캐시해도 안전하다
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

`/sw.js`를 캐시하지 않는 설정이 중요하다. **PWA에서 Service Worker가 캐시되면 사용자가 구버전 앱에 영구히 갇힌다.**

- [ ] **Step 3: Fastify에 프록시 신뢰 설정 추가**

`apps/api/src/app.ts`의 `Fastify({ ... })` 옵션에 추가:

```ts
    // nginx 뒤에 있으므로 X-Forwarded-For를 신뢰해야 req.ip가 실제 클라이언트 IP가 된다.
    // 이 설정이 없으면 로그인 실패 기록의 IP가 전부 127.0.0.1이 된다.
    trustProxy: true,
```

- [ ] **Step 4: 배포 문서 작성**

`docs/deployment.md`:

```markdown
# 배포

## 최초 설치 (서버당 한 번)

```bash
# 1. 패키지
#    Node 22 LTS, pnpm, PostgreSQL 18, nginx, certbot, PM2 설치

# 2. 저장소와 데이터베이스
git clone <저장소 URL> /srv/daily
cd /srv/daily
createdb daily

# 3. 환경변수 — .env.example을 참고해 작성한다. 저장소에 커밋하지 않는다.
cp .env.example .env && $EDITOR .env

# 4. 릴리스·백업 디렉터리
sudo mkdir -p /var/www/daily/releases /var/backups/daily

# 5. nginx + TLS
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/daily
sudo $EDITOR /etc/nginx/sites-available/daily        # example.com을 실제 도메인으로
sudo ln -s /etc/nginx/sites-available/daily /etc/nginx/sites-enabled/daily
sudo certbot --nginx -d <도메인>
sudo nginx -t && sudo systemctl reload nginx

# 6. API 프로세스 등록 — reload는 이미 등록된 프로세스에만 동작하므로
#    첫 기동은 start여야 한다. save로 재부팅 후 자동 복구까지 걸어둔다.
pnpm install --frozen-lockfile
pnpm --filter @daily/api db:migrate
pm2 start apps/api/ecosystem.config.cjs
pm2 save
pm2 startup                                          # 출력된 명령을 그대로 실행
```

## 배포 절차

```bash
git pull
pnpm install --frozen-lockfile

# 1. 마이그레이션 (앱 재시작 전에 실행)
pnpm --filter @daily/api db:migrate

# 2. 프론트 빌드 후 릴리스 디렉터리에 배치
pnpm --filter @daily/web build
RELEASE=/var/www/daily/releases/$(date +%Y%m%d%H%M%S)
mkdir -p "$RELEASE"
cp -r apps/web/dist/* "$RELEASE"
ln -sfn "$RELEASE" /var/www/daily/current

# 3. API 재시작
pm2 reload apps/api/ecosystem.config.cjs
```

## 롤백

배포 직전 커밋 해시를 반드시 기록해둔다. `git log --oneline -1`을 배포 로그에 남기는 것으로 충분하다.

```bash
# 1. 프론트 — 심볼릭 링크만 되돌리면 즉시 반영된다
ln -sfn /var/www/daily/releases/<이전_타임스탬프> /var/www/daily/current

# 2. API — 소스를 되돌리지 않으면 롤백이 아니다
git checkout <이전_커밋_해시>
pnpm install --frozen-lockfile
pm2 reload daily-api
```

**2번을 빠뜨리면 API는 롤백되지 않는다.** PM2는 `tsx`로 작업 트리의 소스를 직접 실행하므로, 프론트처럼 릴리스별 스냅샷이 없다. `git pull`이 이미 끝난 상태에서 `pm2 reload`만 하면 방금 문제를 일으킨 코드를 그대로 다시 띄우는 것이고, 운영자는 롤백했다고 착각하게 된다.

의존성이 버전 간에 달라졌을 수 있으므로 `pnpm install --frozen-lockfile`도 함께 돌린다.

DB 마이그레이션은 되돌아가지 않는다. 그래서 **컬럼 삭제·타입 변경은 배포 두 번에 나눠서 한다** — 먼저 새 컬럼 추가 후 코드 전환, 다음 배포에서 옛 컬럼 제거. 이 규율을 지키는 동안에는 마이그레이션이 항상 이전 버전 코드와 호환되므로, 소스만 되돌리면 롤백이 성립한다.

## 백업

대상 디렉터리는 "최초 설치" 4단계에서 만든다. **셸 리다이렉션은 디렉터리를 만들어주지 않으므로**, 없으면 첫 cron이 조용히 실패하고 아무도 모르는 채 백업이 존재하지 않게 된다.

```bash
sudo mkdir -p /var/backups/daily    # 최초 설치에서 이미 했다면 생략
```

`crontab -e`:

```
0 4 * * * pg_dump daily | gzip > /var/backups/daily/daily-$(date +\%Y\%m\%d).sql.gz
0 5 * * * find /var/backups/daily -name '*.sql.gz' -mtime +7 -delete
```

복구 절차를 실제로 한 번 시험해본다. 시험하지 않은 백업은 백업이 아니다.

## 모니터링

- `pm2 logs daily-api` — 애플리케이션 로그
- `pm2 monit` — 메모리·CPU
- `/api/health` — 헬스체크 엔드포인트
```

- [ ] **Step 5: 루트 스크립트 추가**

`package.json`의 `scripts`에 추가:

```json
"dev:api": "pnpm --filter @daily/api dev",
"dev:web": "pnpm --filter @daily/web dev"
```

- [ ] **Step 6: 전체 테스트와 타입 체크**

Run:
```bash
NODE_ENV=test pnpm test
pnpm typecheck
```
Expected: 모든 패키지 PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/api/ecosystem.config.cjs deploy docs/deployment.md package.json apps/api/src/app.ts
git commit -m "chore: PM2/nginx 배포 구성과 배포 문서"
```

---

## 완료 기준

1단계가 끝나면 다음이 모두 참이어야 한다.

- [ ] `NODE_ENV=test pnpm test`가 전부 통과한다
- [ ] `pnpm typecheck`가 에러 없이 끝난다
- [ ] 브라우저에서 가입 → 홈 진입 → 새로고침 후에도 로그인 유지 → 로그아웃이 동작한다
- [ ] 틀린 비밀번호와 없는 계정의 로그인 응답이 완전히 동일하다
- [ ] 리프레시 토큰을 재사용하면 해당 사용자의 모든 세션이 끊긴다
- [ ] DB의 시각 컬럼에 KST 벽시계 값이 들어가고, 읽을 때 값이 변하지 않는다
- [ ] `.env`가 저장소에 없고, 로그에 비밀번호·토큰이 남지 않는다

## 이 계획에서 의도적으로 빠진 것

설계 문서 6절에는 있지만 1단계에 넣지 않았다. **누락이 아니라 선행 조건이 미결정이기 때문이다.**

| 항목 | 설계 문서 위치 | 미룬 이유 |
|---|---|---|
| `POST /api/auth/password/forgot` | 6절 | 메일 발송 서비스(Resend vs AWS SES)가 아직 선정되지 않았다. 설계 문서 11절 미결정 항목 |
| `POST /api/auth/password/reset` | 6절 | 위와 동일. `password_reset_tokens` 테이블은 Task 4에서 미리 만들어둔다 |
| `POST /api/auth/verify-email` | 6절 | 위와 동일 |
| `DELETE /api/account` (탈퇴) | 6절 | 파기 대상 테이블이 5개 도메인 전부 만들어진 뒤에 구현해야 한다. 지금 만들면 기능을 추가할 때마다 파기 로직을 고쳐야 한다 |

**메일 발송 서비스가 정해지면 별도 계획(`phase1b-account-recovery`)으로 이 네 가지를 묶어 구현한다.** 공개 배포 전에 반드시 필요하다 — 비밀번호를 잊은 사용자가 복구할 방법이 없으면 그 계정은 영구 손실된다.

## 2단계로 넘길 것

- Dexie 도메인 테이블(버전 2 마이그레이션)과 동기화 엔진
- `expenses`, `expense_categories` 테이블과 가입 시 기본 카테고리 생성
- `/api/sync/push`, `/api/sync/pull`
- 지출 입력·목록·수정·삭제 화면
- 미동기화 건수 표시와 로그아웃 가드
- Playwright 오프라인 E2E
