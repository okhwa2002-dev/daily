# 운동 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 날짜별로 운동(근력·유산소)을 기록·수정·삭제하고 서버와 동기화하는 화면을 추가한다.

**Architecture:** DB 테이블 `workouts`는 이미 있다. 그 위에 shared 페이로드 스키마 → 서버 동기화 레지스트리 → Dexie 로컬 스토어 → `pages/workout/` 화면 순으로 쌓는다. 근력 세트는 자식 테이블이 아니라 `sets` `JSONB` 배열이라 동기화 단위가 1레코드로 유지된다. 화면은 `ExpensePage`와 같은 날짜별 단일 화면이다.

**Tech Stack:** TypeScript, zod 3.24, Fastify + Drizzle(PostgreSQL 18), React 19 + Dexie + Tailwind v4, vitest + @testing-library/react

**Spec:** [docs/superpowers/specs/2026-08-13-workout-tracking-design.md](../specs/2026-08-13-workout-tracking-design.md)

## Global Constraints

- **코드값은 대문자다.** `STRENGTH`/`CARDIO`/`ETC`, `CHEST`…`FULL_BODY`, `LOW`/`MID`/`HIGH`. 컬럼명·테이블명은 snake_case 소문자 그대로다.
- **화면 컴포넌트는 API를 직접 호출하지 않는다.** 읽기·쓰기 모두 `repository.ts`를 거쳐 Dexie로 간다. 서버 통신은 `sync/` 계층 전담이다.
- **`pages/workout/`은 `pages/expense/`·`pages/book/`을 임포트하지 않는다.** 공용이 필요하면 `components/`나 `src/` 아래 자기 자리로 뽑는다.
- **`_at` 컬럼에는 짝이 되는 `_by`가 있어야 한다.** 이번 작업은 DB를 건드리지 않으므로 해당 사항이 없지만, 페이로드에 공통 컬럼(`user_id`, `synced_at`, `*_by`, `deleted_at`)을 넣지 않는다는 규칙은 그대로 적용된다.
- **`SCHEMA_VERSION`은 3 → 4.** 배포는 **API 먼저, 웹 나중**이다.
- 타임스탬프는 KST 벽시계 문자열이다. `localNow()`가 만든다.
- 테스트 실행: `pnpm --filter @daily/shared test`, `pnpm --filter @daily/api test`, `pnpm --filter @daily/web test`
- 커밋 메시지는 한글 conventional commits (`feat(web):`, `test(api):`, `fix(shared):`).

## 스펙 초안에서 조정한 것 세 가지

계획을 쓰면서 바꾼 판단이다. **스펙 문서도 같은 내용으로 갱신했으므로 둘은 어긋나지 않는다.** 왜 그렇게 정했는지가 여기 남는다.

1. **`workoutPayloadSchema`는 `workout.ts`가 아니라 `sync.ts`에 둔다.** `expensePayloadSchema`·`bookPayloadSchema`가 전부 `sync.ts`에 있고, `occurredOnSchema`도 거기 있다. `workout.ts`에 두면 `occurredOnSchema`를 복제하거나 순환 임포트가 생긴다. `workout.ts`는 `WorkoutSet`(DB 스키마의 `$type`도 쓰는 값 타입)만 계속 소유한다.
2. **라벨 맵은 `pages/workout/labels.ts`로 분리한다.** `WorkoutForm`(선택지)과 `WorkoutPage`(목록 표시)가 함께 쓰므로 둘 중 한쪽에 두면 다른 쪽이 형제를 임포트하게 된다.
3. **`listRecentNames`의 "최근 90일" 조건을 뺀다.** 200행 상한만 둔다. 날짜 하한을 같이 걸면 오래 쉬었다 돌아온 사용자에게 자동완성이 통째로 비고, 그 사용자야말로 종목 이름을 다시 치기 싫어하는 쪽이다. 행 상한만으로 "폼 열 때 전체 테이블을 읽는다"는 문제는 이미 막힌다.

## File Structure

| 파일 | 책임 |
|---|---|
| `packages/shared/src/sync.ts` (수정) | `workoutPayloadSchema`, `SYNC_TABLE`에 `'workouts'`, `SCHEMA_VERSION` 4 |
| `packages/shared/src/workout.ts` (기존) | `WorkoutSet` 값 타입. 이번에 손대지 않는다 |
| `apps/api/src/sync/registry.ts` (수정) | `workouts` 레지스트리 항목 — 컬럼 ↔ 페이로드 변환 |
| `apps/web/src/db/index.ts` (수정) | `LocalWorkout` + Dexie `version(5)` |
| `apps/web/src/sync/apply.ts` (수정) | pull 행 → 로컬 반영, push 응답 id 기록 |
| `apps/web/src/pages/workout/labels.ts` (신규) | 코드값 → 한글 라벨 |
| `apps/web/src/pages/workout/repository.ts` (신규) | Dexie 읽기/쓰기 + 아웃박스 적재 |
| `apps/web/src/pages/workout/SetRows.tsx` (신규) | 세트 배열 입력 + 폼 행 ↔ `WorkoutSet[]` 변환 |
| `apps/web/src/pages/workout/WorkoutForm.tsx` (신규) | kind 분기 폼 |
| `apps/web/src/pages/workout/WorkoutPage.tsx` (신규) | 날짜 네비 + 목록 + 폼 배치 |
| `apps/web/src/App.tsx` (수정) | `/workouts` 라우트 |
| `apps/web/src/components/TabBar.tsx` (수정) | 탭 한 줄 |

---

## Task 1: shared 페이로드 스키마

**Files:**
- Modify: `packages/shared/src/sync.ts`
- Test: `packages/shared/src/sync.test.ts`

**Interfaces:**
- Consumes: `workoutSetsSchema` (기존, `packages/shared/src/workout.ts`), `BODY_PART`·`INTENSITY` (기존, `codes.ts`)
- Produces:
  - `workoutPayloadSchema: z.ZodDiscriminatedUnion<'kind', …>`
  - `type WorkoutPayload = z.infer<typeof workoutPayloadSchema>` — 필드: `occurredOn: string`, `kind: 'STRENGTH'|'CARDIO'|'ETC'`, `name: string`, `bodyPart: BodyPart|null`, `sets: WorkoutSet[]|null`, `durationMin: number|null`, `intensity: Intensity|null`, `memo: string|null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/sync.test.ts` 끝에 추가한다.

```ts
describe('workoutPayloadSchema', () => {
  const base = { occurredOn: '2026-08-13', name: '벤치프레스' }

  it('근력은 세트를 받고 durationMin은 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'STRENGTH',
      sets: [{ reps: 10, weightKg: 60 }],
    })
    expect(parsed.durationMin).toBeNull()
    // 안 보낸 선택 필드는 default로 채워져야 한다. undefined로 남으면
    // toColumns가 그 컬럼을 통째로 빼먹어 수정이 반영되지 않는다.
    expect(parsed.bodyPart).toBeNull()
    expect(parsed.intensity).toBeNull()
    expect(parsed.memo).toBeNull()
  })

  it('맨몸 운동은 weightKg가 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'STRENGTH', sets: [{ reps: 12, weightKg: null }],
    })
    expect(parsed.sets).toEqual([{ reps: 12, weightKg: null }])
  })

  it('유산소는 지속 시간을 받고 sets는 null이다', () => {
    const parsed = workoutPayloadSchema.parse({
      ...base, kind: 'CARDIO', name: '러닝', durationMin: 30, intensity: 'MID',
    })
    expect(parsed.sets).toBeNull()
    expect(parsed.durationMin).toBe(30)
  })

  // 여기서 안 걸리면 DB의 workouts_shape_ck 위반이 되고, 그 500은
  // REJECTED가 아니라 재시도 대상이라 그 항목이 큐에서 영원히 빠지지 않는다.
  it('근력에 durationMin을 실으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: [{ reps: 10, weightKg: 60 }], durationMin: 30,
    }).success).toBe(false)
  })

  it('유산소에 sets를 실으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 30, sets: [{ reps: 10, weightKg: 60 }],
    }).success).toBe(false)
  })

  it('유산소에 durationMin이 없으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({ ...base, kind: 'CARDIO' }).success).toBe(false)
  })

  it('근력에 sets가 없으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({ ...base, kind: 'STRENGTH' }).success).toBe(false)
  })

  it('세트가 0개거나 51개면 거부한다', () => {
    const set = { reps: 10, weightKg: 60 }
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: [],
    }).success).toBe(false)
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'STRENGTH', sets: Array.from({ length: 51 }, () => set),
    }).success).toBe(false)
  })

  it('지속 시간이 하루를 넘으면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 1441,
    }).success).toBe(false)
  })

  it('종목명이 비면 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, name: '   ', kind: 'CARDIO', durationMin: 30,
    }).success).toBe(false)
  })

  // 공통 컬럼이 클라이언트에서 넘어올 경로를 남기지 않는다.
  it('모르는 키는 거부한다', () => {
    expect(workoutPayloadSchema.safeParse({
      ...base, kind: 'CARDIO', durationMin: 30, userId: 9,
    }).success).toBe(false)
  })

  it('ETC는 세트도 시간도 없이 통과한다', () => {
    const parsed = workoutPayloadSchema.parse({ ...base, kind: 'ETC', name: '요가' })
    expect(parsed.sets).toBeNull()
    expect(parsed.durationMin).toBeNull()
  })
})
```

`workoutPayloadSchema`를 파일 상단 import에 추가한다 (같은 패키지이므로 `./sync.ts`에서 온다 — 테스트 파일의 기존 import 구문에 이름만 더한다).

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @daily/shared test`
Expected: FAIL — `workoutPayloadSchema is not defined` 또는 import 에러

- [ ] **Step 3: 스키마를 구현한다**

`packages/shared/src/sync.ts`의 import에 `BODY_PART`, `INTENSITY`를 더하고 `workoutSetsSchema`를 새로 가져온다.

```ts
import {
  BODY_PART, BOOK_STATUS, EXPENSE_KIND, INTENSITY,
  OUTBOX_OP, SYNC_RESULT, type SyncResult,
} from './codes.ts'
import { workoutSetsSchema } from './workout.ts'
```

`bookNotePayloadSchema` 아래에 추가한다.

```ts
/** kind와 무관하게 항상 있는 필드. 분기되는 것은 sets·durationMin 둘뿐이다. */
const workoutBaseShape = {
  occurredOn: occurredOnSchema,
  /** 종목은 자유 입력이다. 마스터 테이블을 두지 않는다 */
  name: z.string().trim().min(1).max(100),
  bodyPart: z.enum(BODY_PART).nullable().default(null),
  intensity: z.enum(INTENSITY).nullable().default(null),
  memo: z.string().max(500).nullable().default(null),
}

/** 상한은 하루다. 상한이 없으면 오타 하나가 그대로 저장된다. */
const durationMinSchema = z.number().int().positive().max(1440)

/**
 * 운동 기록. `kind`에 따라 채워지는 필드가 다르다.
 *
 * DB의 `workouts_shape_ck`와 같은 규칙이다. 반대쪽 필드를 "생략 가능"이 아니라
 * **`z.null()`로 못박는 것**이 핵심이다. `.strict()`와 합쳐져야 'CARDIO인데
 * sets를 실어 보내는' 요청이 여기서 걸린다. 여기서 안 걸리면 그 요청은 DB
 * CHECK 위반이 되고, 그 500은 REJECTED가 아니라 재시도 대상이라 그 항목이
 * 큐에서 영원히 빠지지 않는다.
 *
 * `ETC`는 화면에 없지만 스키마에는 남긴다. CHECK가 세 분기이므로 거울도 세
 * 분기여야 하고, 나중에 화면을 붙일 때 SCHEMA_VERSION을 다시 올리지 않아도 된다.
 */
export const workoutPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    ...workoutBaseShape,
    kind: z.literal('STRENGTH'),
    sets: workoutSetsSchema,
    durationMin: z.null().default(null),
  }).strict(),
  z.object({
    ...workoutBaseShape,
    kind: z.literal('CARDIO'),
    sets: z.null().default(null),
    durationMin: durationMinSchema,
  }).strict(),
  z.object({
    ...workoutBaseShape,
    kind: z.literal('ETC'),
    sets: workoutSetsSchema.nullable().default(null),
    durationMin: durationMinSchema.nullable().default(null),
  }).strict(),
])
export type WorkoutPayload = z.infer<typeof workoutPayloadSchema>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @daily/shared test`
Expected: PASS (전체 스위트)

Run: `pnpm --filter @daily/shared typecheck`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add packages/shared/src/sync.ts packages/shared/src/sync.test.ts
git commit -m "feat(shared): 운동 페이로드 스키마"
```

---

## Task 2: 동기화 배선

`SYNC_TABLE`에 `'workouts'`를 넣는 순간 `Record<SyncTable, …>`인 자리들이 전부 컴파일 에러가 된다. 서버 레지스트리와 웹 로컬 스토어를 **한 작업으로 묶는 이유**가 이것이다 — 나누면 중간 상태에서 타입 체크가 깨져 어느 쪽도 독립적으로 검증할 수 없다.

**Files:**
- Modify: `packages/shared/src/sync.ts` (`SCHEMA_VERSION`, `SYNC_TABLE`)
- Modify: `apps/api/src/sync/registry.ts`
- Modify: `apps/web/src/db/index.ts`
- Modify: `apps/web/src/sync/apply.ts`
- Test: `apps/api/src/routes/sync.test.ts`, `apps/web/src/sync/apply.test.ts`

**Interfaces:**
- Consumes: `workoutPayloadSchema`, `WorkoutPayload` (Task 1), `workouts` 테이블 (`apps/api/src/db/schema.ts`, 기존)
- Produces:
  - `SYNC_TABLE`에 `'workouts'` 포함, `SCHEMA_VERSION === 4`
  - `db.workouts: EntityTable<LocalWorkout, 'clientUuid'>`
  - `interface LocalWorkout` — `clientUuid`·`userId`·`serverId`·`updatedAt`·`deletedAt`(`LocalRecord`) + `occurredOn: string`, `kind: WorkoutKind`, `name: string`, `bodyPart: BodyPart|null`, `sets: WorkoutSet[]|null`, `durationMin: number|null`, `intensity: Intensity|null`, `memo: string|null`

- [ ] **Step 1: 실패하는 서버 테스트를 쓴다**

`apps/api/src/routes/sync.test.ts`를 고친다.

1. schema import에 `workouts`를 더한다: `import { bookNotes, books, codes, expenseCategories, expenses, users, workouts } from '../db/schema.ts'`
2. `ChangeInput['table']` 유니온에 `| 'workouts'`를 더한다.
3. `settle()`에 한 줄 더한다: `await db.update(workouts).set({ syncedAt: past })`
4. 아래 describe를 파일 끝에 추가한다.

```ts
describe('운동 동기화', () => {
  const strength = (over: Record<string, unknown> = {}) => ({
    occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
    sets: [{ reps: 10, weightKg: 60 }, { reps: 8, weightKg: 60 }], ...over,
  })

  it('세트를 JSONB로 저장하고 pull에서 객체 배열 그대로 내려준다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'workouts', clientUuid: UUID(1),
      updatedAt: '2026-08-13T12:00:00+09:00', payload: strength(),
    }])
    expect(body.results[0]?.status).toBe('APPLIED')

    // 손으로 JSON.stringify를 끼워 넣으면 여기서 문자열이 나온다.
    // CHECK는 그걸 막지 못하므로 이 단언이 유일한 방어다.
    const [row] = await db.select().from(workouts)
    expect(row?.sets).toEqual([{ reps: 10, weightKg: 60 }, { reps: 8, weightKg: 60 }])
    expect(row?.durationMin).toBeNull()

    await settle()
    const { body: pulled } = await pull(auth)
    const change = pulled.changes.find((c) => c.table === 'workouts')
    expect(change?.payload.sets).toEqual([{ reps: 10, weightKg: 60 }, { reps: 8, weightKg: 60 }])
    expect(change?.occurredOn).toBe(TODAY)
  })

  it('유산소는 durationMin을 저장하고 sets는 비운다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'workouts', clientUuid: UUID(2),
      updatedAt: '2026-08-13T12:00:00+09:00',
      payload: { occurredOn: TODAY, kind: 'CARDIO', name: '러닝', durationMin: 30 },
    }])
    expect(body.results[0]?.status).toBe('APPLIED')

    const [row] = await db.select().from(workouts)
    expect(row?.durationMin).toBe(30)
    expect(row?.sets).toBeNull()
  })

  // REJECTED여야 한다. 500이면 재시도 대상이라 큐가 이 항목에서 막힌다.
  it('모양이 깨진 세트는 REJECTED로 돌려준다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { res, body } = await push(auth, [{
      table: 'workouts', clientUuid: UUID(3),
      updatedAt: '2026-08-13T12:00:00+09:00',
      payload: strength({ sets: [{ weightKg: 60 }] }),
    }])
    expect(res.statusCode).toBe(200)
    expect(body.results[0]?.status).toBe('REJECTED')
    expect(await db.select().from(workouts)).toHaveLength(0)
  })

  it('남의 운동은 pull로 내려오지 않는다', async () => {
    const mine = await tokenFor(await makeUser('a@example.com'))
    const theirs = await tokenFor(await makeUser('b@example.com'))
    await push(theirs, [{
      table: 'workouts', clientUuid: UUID(4),
      updatedAt: '2026-08-13T12:00:00+09:00', payload: strength(),
    }])
    await settle()

    const { body } = await pull(mine)
    expect(body.changes.filter((c) => c.table === 'workouts')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패하는 웹 apply 테스트를 쓴다**

`apps/web/src/sync/apply.test.ts`에 추가한다. 상단에 상수를 하나 더한다: `const WORKOUT_UUID = 'cccccccc-0000-4000-8000-000000000003'`

```ts
const workoutRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'workouts', id: 30, clientUuid: WORKOUT_UUID, occurredOn: '2026-08-13',
  updatedAt: '2026-08-13 12:00:00.000', syncedAt: '2026-08-13 12:00:00.500',
  deletedAt: null,
  payload: {
    occurredOn: '2026-08-13', kind: 'STRENGTH', name: '벤치프레스',
    bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }],
    durationMin: null, intensity: 'MID', memo: null,
  },
  ...over,
})

describe('applyServerRows — 운동', () => {
  it('서버에서 내려온 운동을 세트까지 로컬에 넣는다', async () => {
    await applyServerRows(USER, [workoutRow()])

    const local = await db.workouts.get(WORKOUT_UUID)
    expect(local?.name).toBe('벤치프레스')
    expect(local?.kind).toBe('STRENGTH')
    expect(local?.bodyPart).toBe('CHEST')
    expect(local?.intensity).toBe('MID')
    // APPLIERS에서 sets 줄이 통째로 빠져도 나머지 단언은 전부 통과한다.
    expect(local?.sets).toEqual([{ reps: 10, weightKg: 60 }])
    expect(local?.serverId).toBe(30)
  })

  it('유산소는 durationMin이 채워지고 sets는 null이다', async () => {
    await applyServerRows(USER, [workoutRow({
      payload: {
        occurredOn: '2026-08-13', kind: 'CARDIO', name: '러닝', bodyPart: null,
        sets: null, durationMin: 30, intensity: null, memo: null,
      },
    })])

    const local = await db.workouts.get(WORKOUT_UUID)
    expect(local?.durationMin).toBe(30)
    expect(local?.sets).toBeNull()
  })
})

describe('recordServerId — 운동', () => {
  it('운동의 serverId를 운동 스토어에 기록한다', async () => {
    await db.workouts.put({
      clientUuid: WORKOUT_UUID, userId: USER, serverId: null,
      occurredOn: '2026-08-13', kind: 'CARDIO', name: '러닝', bodyPart: null,
      sets: null, durationMin: 30, intensity: null, memo: null,
      updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
    })

    await recordServerId('workouts', WORKOUT_UUID, 44)

    expect((await db.workouts.get(WORKOUT_UUID))?.serverId).toBe(44)
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm --filter @daily/api test -- sync` 와 `pnpm --filter @daily/web test -- apply`
Expected: FAIL — `'workouts'` 가 `SyncTable`에 없다는 타입 에러, `db.workouts` 없음

- [ ] **Step 4: `SYNC_TABLE`과 `SCHEMA_VERSION`을 올린다**

`packages/shared/src/sync.ts`:

```ts
export const SCHEMA_VERSION = 4
```

```ts
export const SYNC_TABLE = [
  'expense_categories', 'expenses', 'books', 'book_notes', 'workouts',
] as const
```

`SCHEMA_VERSION` 주석은 그대로 둔다 — 그 주석이 설명하는 상황이 지금 벌어지는 일이다.

- [ ] **Step 5: 서버 레지스트리 항목을 더한다**

`apps/api/src/sync/registry.ts`. import를 고친다.

```ts
import {
  bookNotePayloadSchema, bookPayloadSchema, CODE_GROUP,
  expenseCategoryPayloadSchema, expensePayloadSchema, workoutPayloadSchema,
  type BookNotePayload, type BookPayload,
  type ExpenseCategoryPayload, type ExpensePayload, type SyncTable,
  type WorkoutPayload,
} from '@daily/shared'
import { bookNotes, books, codes, expenseCategories, expenses, workouts } from '../db/schema.ts'
```

`SYNC_REGISTRY`의 `book_notes` 아래에 더한다.

```ts
  /**
   * 운동. 부모 참조도 `validate`도 없다.
   *
   * `validate`는 zod로 막을 수 없는 것만 오는 자리다. 운동의 코드값은 전부
   * `codes.ts`의 정적 집합이라 `z.enum`에서 걸린다 — `BOOK_GENRE`가 여기를
   * 쓰는 것은 값 집합이 DB의 `codes` 테이블에 있어서다.
   *
   * `sets`는 손대지 않고 그대로 넘긴다. `jsonb` 컬럼이 객체를 다루므로
   * `JSON.stringify`를 끼워 넣으면 따옴표로 감싼 문자열이 저장되고,
   * `workouts_shape_ck`는 `IS NOT NULL`까지만 보므로 그걸 막지 못한다.
   */
  workouts: define<WorkoutPayload>({
    table: workouts,
    payload: workoutPayloadSchema,
    hasOccurredOn: true,
    toColumns: (p: WorkoutPayload) => ({
      occurredOn: p.occurredOn,
      kind: p.kind,
      name: p.name,
      bodyPart: p.bodyPart,
      sets: p.sets,
      durationMin: p.durationMin,
      intensity: p.intensity,
      memo: p.memo,
    }),
    toPayload: (r) => ({
      occurredOn: r.occurredOn,
      kind: r.kind,
      name: r.name,
      bodyPart: r.bodyPart,
      sets: r.sets,
      durationMin: r.durationMin,
      intensity: r.intensity,
      memo: r.memo,
    }),
  }),
```

파일 상단 `SYNC_REGISTRY` 주석의 "나머지 도메인(운동·식사·일기)은 화면이 만들어지는 시점에 추가한다"를 "나머지 도메인(식사·일기)은…"으로 고친다.

- [ ] **Step 6: 웹 로컬 스토어를 더한다**

`apps/web/src/db/index.ts`. import를 고친다.

```ts
import type {
  BodyPart, BookStatus, ExpenseKind, Intensity, OutboxOp, SyncTable,
  WorkoutKind, WorkoutSet,
} from '@daily/shared'
```

`LocalBookNote` 아래에 더한다.

```ts
export interface LocalWorkout extends LocalRecord {
  occurredOn: string
  kind: WorkoutKind
  name: string
  bodyPart: BodyPart | null
  /** 근력 세트. 자식 테이블이 아니라 값 덩어리다 — 운동과 항상 함께 바뀐다 */
  sets: WorkoutSet[] | null
  /** 유산소 지속 시간(분) */
  durationMin: number | null
  intensity: Intensity | null
  memo: string | null
}
```

클래스에 필드를 더한다.

```ts
  workouts!: EntityTable<LocalWorkout, 'clientUuid'>
```

생성자 끝에 버전을 더한다.

```ts
    // deletedAt을 인덱스에 넣지 않는 것은 version 2·3과 같은 이유다 —
    // IndexedDB가 null을 키로 쓰지 못해 살아있는 레코드가 통째로 빠진다.
    // name 인덱스도 만들지 않는다. 자동완성에 필요한 것은 "최근 쓴 순서"라
    // name 인덱스로는 답이 안 나오고, [userId+occurredOn] 역순 스캔이면 된다.
    this.version(5).stores({
      workouts: 'clientUuid, userId, [userId+occurredOn]',
    })
```

- [ ] **Step 7: apply.ts를 채운다**

`apps/web/src/sync/apply.ts`. import를 고친다.

```ts
import type {
  BodyPart, BookStatus, ExpenseKind, Intensity, SyncRow, SyncTable,
  WorkoutKind, WorkoutSet,
} from '@daily/shared'
```

`APPLIERS`의 `book_notes` 아래에 더한다.

```ts
  workouts: (userId, row) => applyToTable(db.workouts, userId, row, (r) => ({
    clientUuid: r.clientUuid,
    userId,
    serverId: r.id,
    occurredOn: String(r.payload.occurredOn),
    kind: r.payload.kind as WorkoutKind,
    name: String(r.payload.name),
    bodyPart: (r.payload.bodyPart as BodyPart | null) ?? null,
    sets: (r.payload.sets as WorkoutSet[] | null) ?? null,
    durationMin: (r.payload.durationMin as number | null) ?? null,
    intensity: (r.payload.intensity as Intensity | null) ?? null,
    memo: (r.payload.memo as string | null) ?? null,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  })),
```

`SERVER_ID_STORES`에 더한다.

```ts
  workouts: db.workouts,
```

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm --filter @daily/api test`
Expected: PASS

Run: `pnpm --filter @daily/web test`
Expected: PASS

Run: `pnpm typecheck`
Expected: 세 패키지 모두 에러 없음

- [ ] **Step 9: 커밋**

```bash
git add packages/shared/src/sync.ts apps/api/src/sync/registry.ts \
        apps/api/src/routes/sync.test.ts apps/web/src/db/index.ts \
        apps/web/src/sync/apply.ts apps/web/src/sync/apply.test.ts
git commit -m "feat: 운동 동기화 배선 (스키마 버전 4)"
```

---

## Task 3: 로컬 저장소

**Files:**
- Create: `apps/web/src/pages/workout/repository.ts`
- Test: `apps/web/src/pages/workout/repository.test.ts`

**Interfaces:**
- Consumes: `db.workouts`·`LocalWorkout` (Task 2), `enqueue`·`localNow` (`apps/web/src/sync/outbox.ts`, 기존)
- Produces:
  - `interface WorkoutInput` — `occurredOn: string`, `kind: WorkoutKind`, `name: string`, `bodyPart: BodyPart|null`, `sets: WorkoutSet[]|null`, `durationMin: number|null`, `intensity: Intensity|null`, `memo: string|null`
  - `listWorkoutsByDate(userId: number, occurredOn: string): Promise<LocalWorkout[]>`
  - `listRecentNames(userId: number, limit?: number): Promise<string[]>`
  - `saveWorkout(userId: number, input: WorkoutInput, clientUuid?: string): Promise<string>`
  - `deleteWorkout(userId: number, clientUuid: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/workout/repository.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { takeBatch } from '../../sync/outbox.ts'
import {
  deleteWorkout, listRecentNames, listWorkoutsByDate, saveWorkout,
  type WorkoutInput,
} from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-13'

const strength = (over: Partial<WorkoutInput> = {}): WorkoutInput => ({
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, ...over,
})

beforeEach(async () => {
  await db.workouts.clear()
  await db.outbox.clear()
})

describe('운동 저장', () => {
  it('로컬에 저장하고 같은 동작으로 큐에 넣는다', async () => {
    const uuid = await saveWorkout(USER, strength({ memo: '가슴날' }))

    const rows = await listWorkoutsByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.memo).toBe('가슴날')
    // 레코드만 쓰이고 큐 적재가 빠지면 그 기록은 이 기기에만 남는다.
    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.clientUuid).toBe(uuid)
  })

  // db.workouts.put과 enqueue 두 곳을 모두 고쳐야 하는 자리다. 로컬만
  // 확인하면 payload.sets가 undefined로 새어도 통과한다.
  it('세트가 큐 페이로드까지 그대로 간다', async () => {
    await saveWorkout(USER, strength({
      sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }],
    }))

    const [row] = await takeBatch(1)
    expect((row!.payload as { sets: unknown }).sets).toEqual([
      { reps: 10, weightKg: 60 }, { reps: 12, weightKg: null },
    ])
  })

  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveWorkout(USER, strength())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort()).toEqual([
      'bodyPart', 'durationMin', 'intensity', 'kind', 'memo',
      'name', 'occurredOn', 'sets',
    ])
  })

  it('같은 clientUuid로 다시 저장하면 수정이다', async () => {
    const uuid = await saveWorkout(USER, strength({ sets: [{ reps: 10, weightKg: 60 }] }))
    await saveWorkout(USER, strength({ sets: [{ reps: 8, weightKg: 70 }] }), uuid)

    const rows = await listWorkoutsByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sets).toEqual([{ reps: 8, weightKg: 70 }])
    expect(await takeBatch(10)).toHaveLength(1)
  })

  it('다른 날짜·다른 사용자의 기록은 섞이지 않는다', async () => {
    await saveWorkout(USER, strength())
    await saveWorkout(USER, strength({ occurredOn: '2026-08-12' }))
    await saveWorkout(OTHER, strength())

    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(1)
  })
})

describe('운동 삭제', () => {
  it('툼스톤을 남기고 조회에서 뺀다', async () => {
    const uuid = await saveWorkout(USER, strength())
    await db.workouts.update(uuid, { serverId: 5 })
    await db.outbox.clear()

    await deleteWorkout(USER, uuid)

    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(0)
    // 물리 삭제하면 삭제가 다른 기기로 전파되지 않아 되살아난다.
    expect((await db.workouts.get(uuid))?.deletedAt).not.toBeNull()
    const [queued] = await takeBatch(1)
    expect(queued?.op).toBe('DELETE')
  })

  it('남의 레코드는 건드리지 않는다', async () => {
    const uuid = await saveWorkout(USER, strength())
    await deleteWorkout(OTHER, uuid)
    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(1)
  })
})

describe('최근 종목', () => {
  it('최근순으로 중복 없이 돌려준다', async () => {
    await saveWorkout(USER, strength({ occurredOn: '2026-08-11', name: '스쿼트' }))
    await saveWorkout(USER, strength({ occurredOn: '2026-08-12', name: '벤치프레스' }))
    await saveWorkout(USER, strength({ occurredOn: '2026-08-13', name: '스쿼트' }))

    expect(await listRecentNames(USER)).toEqual(['스쿼트', '벤치프레스'])
  })

  it('삭제된 기록의 종목은 빠진다', async () => {
    const uuid = await saveWorkout(USER, strength({ name: '데드리프트' }))
    await deleteWorkout(USER, uuid)

    expect(await listRecentNames(USER)).toEqual([])
  })

  it('다른 사용자의 종목은 섞이지 않는다', async () => {
    await saveWorkout(OTHER, strength({ name: '남의운동' }))
    expect(await listRecentNames(USER)).toEqual([])
  })

  it('limit을 넘지 않는다', async () => {
    for (const name of ['A', 'B', 'C']) {
      await saveWorkout(USER, strength({ name }))
    }
    expect(await listRecentNames(USER, 2)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @daily/web test -- workout/repository`
Expected: FAIL — `./repository.ts` 를 찾을 수 없음

- [ ] **Step 3: 저장소를 구현한다**

`apps/web/src/pages/workout/repository.ts`

```ts
import type { BodyPart, Intensity, WorkoutKind, WorkoutSet } from '@daily/shared'
import { db, type LocalWorkout } from '../../db/index.ts'
import { enqueue, localNow } from '../../sync/outbox.ts'

/**
 * 화면이 운동 데이터에 닿는 유일한 통로.
 *
 * 읽기·쓰기 모두 로컬 Dexie를 거친다. 화면 컴포넌트는 API를 직접 호출하지
 * 않는다 — 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너진다.
 */

export interface WorkoutInput {
  occurredOn: string
  kind: WorkoutKind
  name: string
  bodyPart: BodyPart | null
  sets: WorkoutSet[] | null
  durationMin: number | null
  intensity: Intensity | null
  memo: string | null
}

/** 자동완성 후보를 찾을 때 훑는 행의 상한. 없으면 폼을 열 때마다 전체를 읽는다. */
const RECENT_SCAN_ROWS = 200

/** `[userId+occurredOn]` 범위 스캔의 양 끝. 날짜 문자열이라 사전순이 곧 시간순이다. */
const DATE_MIN = '0000-01-01'
const DATE_MAX = '9999-12-31'

function newUuid(): string {
  return crypto.randomUUID()
}

/** 살아있는 레코드만 남긴다. deletedAt은 인덱스에 없으므로 여기서 거른다. */
function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}

/** 서버가 받는 필드만 담는다. 공통 컬럼은 서버가 채운다. */
function toPayload(input: WorkoutInput) {
  return {
    occurredOn: input.occurredOn,
    kind: input.kind,
    name: input.name,
    bodyPart: input.bodyPart,
    sets: input.sets,
    durationMin: input.durationMin,
    intensity: input.intensity,
    memo: input.memo,
  }
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export async function listWorkoutsByDate(
  userId: number,
  occurredOn: string,
): Promise<LocalWorkout[]> {
  const rows = await db.workouts.where('[userId+occurredOn]')
    .equals([userId, occurredOn]).toArray()
  return live(rows)
}

export async function getWorkout(
  userId: number,
  clientUuid: string,
): Promise<LocalWorkout | undefined> {
  const row = await db.workouts.get(clientUuid)
  if (!row || row.userId !== userId || row.deletedAt !== null) return undefined
  return row
}

/**
 * 최근에 기록한 종목 이름을 최근순·중복 없이 돌려준다.
 *
 * 종목은 자유 입력이라 매번 '벤치프레스'를 다시 치게 된다. 마스터 테이블
 * 대신 이 목록을 `<datalist>`로 제안한다.
 *
 * `name` 인덱스를 따로 만들지 않는 이유는 필요한 것이 "최근 쓴 순서"이기
 * 때문이다. `[userId+occurredOn]`을 역순으로 훑으면 그 순서가 그냥 나온다.
 */
export async function listRecentNames(userId: number, limit = 20): Promise<string[]> {
  const rows = await db.workouts.where('[userId+occurredOn]')
    .between([userId, DATE_MIN], [userId, DATE_MAX], true, true)
    .reverse()
    .limit(RECENT_SCAN_ROWS)
    .toArray()

  const names: string[] = []
  for (const row of live(rows)) {
    if (names.includes(row.name)) continue
    names.push(row.name)
    if (names.length >= limit) break
  }
  return names
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 운동을 저장하고 같은 트랜잭션에서 큐에 넣는다.
 *
 * 레코드만 쓰이고 큐 적재가 실패하면 그 변경은 이 기기에만 남아 영영 서버로
 * 가지 않는다. 사용자는 다른 기기에서 기록이 비어 있는 것을 나중에 발견한다.
 */
export async function saveWorkout(
  userId: number,
  input: WorkoutInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = await db.workouts.get(clientUuid)
    await db.workouts.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      ...toPayload(input),
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'workouts',
      clientUuid,
      op: 'UPSERT',
      payload: toPayload(input),
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteWorkout(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = await db.workouts.get(clientUuid)
    // 남의 레코드나 없는 레코드는 건드리지 않는다.
    if (!existing || existing.userId !== userId) return

    // 툼스톤을 남긴다. 물리 삭제하면 삭제가 다른 기기로 전파되지 않는다.
    await db.workouts.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'workouts',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @daily/web test -- workout/repository`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/workout/repository.ts apps/web/src/pages/workout/repository.test.ts
git commit -m "feat(web): 운동 저장소"
```

---

## Task 4: 세트 입력 컴포넌트

**Files:**
- Create: `apps/web/src/pages/workout/SetRows.tsx`
- Test: `apps/web/src/pages/workout/SetRows.test.tsx`

**Interfaces:**
- Consumes: `WorkoutSet` (`@daily/shared`, 기존)
- Produces:
  - `interface SetRow { weightKg: string; reps: string }` — 입력 중에는 빈 문자열일 수 있는 폼 행
  - `emptySetRow(): SetRow`
  - `toSets(rows: SetRow[]): WorkoutSet[]` — 저장 직전 변환
  - `toSetRows(sets: WorkoutSet[] | null): SetRow[]` — 수정 폼 초기값
  - `MAX_SETS: 50`
  - default export `SetRows` — props `{ rows: SetRow[]; onChange: (rows: SetRow[]) => void }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/workout/SetRows.test.tsx`

```tsx
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetRows, { emptySetRow, toSetRows, toSets, type SetRow } from './SetRows.tsx'

function Harness({ initial }: { initial: SetRow[] }) {
  const [rows, setRows] = useState(initial)
  return (
    <>
      <SetRows rows={rows} onChange={setRows} />
      <output data-testid="json">{JSON.stringify(toSets(rows))}</output>
    </>
  )
}

const json = () => JSON.parse(screen.getByTestId('json').textContent ?? 'null')

describe('toSets', () => {
  // [+ 세트]로 복사해 놓고 안 채운 행이 그대로 실려 나가면
  // reps가 positive()에서 걸려 저장이 통째로 거부된다.
  it('무게·횟수가 모두 빈 행은 버린다', () => {
    expect(toSets([{ weightKg: '60', reps: '10' }, emptySetRow()]))
      .toEqual([{ reps: 10, weightKg: 60 }])
  })

  // 0kg과 '무게 없음'은 다르다. 0으로 바꾸면 스키마가 통과시켜 버린다.
  it('무게만 비면 맨몸 운동이다 — null이지 0이 아니다', () => {
    expect(toSets([{ weightKg: '', reps: '12' }]))
      .toEqual([{ reps: 12, weightKg: null }])
  })

  it('빈 배열이 되면 빈 배열을 돌려준다', () => {
    expect(toSets([emptySetRow()])).toEqual([])
  })
})

describe('toSetRows', () => {
  it('서버 세트를 폼 행으로 되돌린다', () => {
    expect(toSetRows([{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }]))
      .toEqual([{ weightKg: '60', reps: '10' }, { weightKg: '', reps: '12' }])
  })

  it('세트가 없으면 빈 행 하나로 시작한다', () => {
    expect(toSetRows(null)).toEqual([emptySetRow()])
  })
})

describe('SetRows 화면', () => {
  it('[+ 세트]가 마지막 행의 무게·횟수를 복사한다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ weightKg: '60', reps: '10' }]} />)

    await user.click(screen.getByRole('button', { name: '세트 추가' }))

    expect(json()).toEqual([
      { reps: 10, weightKg: 60 }, { reps: 10, weightKg: 60 },
    ])
  })

  it('첫 행은 빈 값이다', () => {
    render(<Harness initial={[emptySetRow()]} />)
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('')
    expect(screen.getByLabelText('1세트 횟수')).toHaveValue('')
  })

  it('행을 지울 수 있다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[
      { weightKg: '60', reps: '10' }, { weightKg: '50', reps: '8' },
    ]} />)

    await user.click(screen.getByRole('button', { name: '2세트 삭제' }))

    expect(json()).toEqual([{ reps: 10, weightKg: 60 }])
  })

  // workoutSetsSchema가 .min(1)이다. 마지막 행까지 지우면 저장이 거부된다.
  it('마지막 한 행은 지울 수 없다', () => {
    render(<Harness initial={[{ weightKg: '60', reps: '10' }]} />)
    expect(screen.queryByRole('button', { name: '1세트 삭제' })).not.toBeInTheDocument()
  })

  it('50세트에 도달하면 더 추가할 수 없다', () => {
    render(<Harness initial={Array.from({ length: 50 }, () => ({
      weightKg: '60', reps: '10',
    }))} />)
    expect(screen.getByRole('button', { name: '세트 추가' })).toBeDisabled()
  })

  it('숫자가 아닌 입력은 들어가지 않는다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[emptySetRow()]} />)

    await user.type(screen.getByLabelText('1세트 횟수'), 'a1b2')

    expect(screen.getByLabelText('1세트 횟수')).toHaveValue('12')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @daily/web test -- SetRows`
Expected: FAIL — `./SetRows.tsx` 를 찾을 수 없음

- [ ] **Step 3: 컴포넌트를 구현한다**

`apps/web/src/pages/workout/SetRows.tsx`

```tsx
import type { WorkoutSet } from '@daily/shared'

/** `workoutSetsSchema`의 `.max(50)`과 같은 값이다. */
export const MAX_SETS = 50

/**
 * 폼이 다루는 세트 한 행.
 *
 * 문자열인 것은 의도한 것이다. 입력 중에는 빈 칸일 수 있고, 숫자로 바꾸는
 * 순간 빈 칸과 0을 구분할 수 없게 된다 — 그 둘은 맨몸 운동과 0kg으로 갈린다.
 */
export interface SetRow {
  weightKg: string
  reps: string
}

export const emptySetRow = (): SetRow => ({ weightKg: '', reps: '' })

/** 숫자가 아닌 것은 애초에 입력되지 않게 한다. 타이핑·붙여넣기가 같이 지나는 길목이다. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * 저장 직전에 폼 행을 페이로드 세트로 바꾼다.
 *
 * - 무게·횟수가 **모두** 빈 행은 버린다. `[+ 세트]`로 복사해 놓고 안 채운
 *   행이 그대로 실려 나가면 `reps`가 `positive()`에서 걸려 저장이 통째로
 *   거부되고, 사용자는 이유를 알 수 없다.
 * - 무게만 빈 행은 맨몸 운동이다. `0`으로 바꾸지 않는다 — `0kg`과 "무게 없음"은
 *   다르고, 스키마가 둘 다 허용하므로 잘못된 값이 저장까지 통과해 버린다.
 */
export function toSets(rows: SetRow[]): WorkoutSet[] {
  return rows
    .filter((r) => r.weightKg !== '' || r.reps !== '')
    .map((r) => ({
      reps: Number(r.reps),
      weightKg: r.weightKg === '' ? null : Number(r.weightKg),
    }))
}

/** 수정 폼의 초기값. 세트가 없으면 빈 행 하나로 시작한다. */
export function toSetRows(sets: WorkoutSet[] | null): SetRow[] {
  if (!sets || sets.length === 0) return [emptySetRow()]
  return sets.map((s) => ({
    weightKg: s.weightKg === null ? '' : String(s.weightKg),
    reps: String(s.reps),
  }))
}

interface Props {
  rows: SetRow[]
  onChange: (rows: SetRow[]) => void
}

export default function SetRows({ rows, onChange }: Props) {
  function update(index: number, patch: Partial<SetRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /**
   * 마지막 행을 복사해 새 행을 만든다.
   *
   * 근력 운동은 세트 간 무게·횟수가 거의 같아 매번 다시 치는 것이 입력
   * 부담의 대부분이다. 값이 다른 세트는 복사된 값을 고치면 된다.
   */
  function add() {
    const last = rows[rows.length - 1] ?? emptySetRow()
    onChange([...rows, { ...last }])
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        // 세트에는 안정적인 식별자가 없다. 행 삭제가 뒤쪽 행의 값을 앞으로
        // 당기는 형태라 인덱스 key로도 표시가 어긋나지 않는다.
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-sm text-gray-500">{i + 1}</span>
          <input
            aria-label={`${i + 1}세트 무게(kg)`}
            value={row.weightKg}
            onChange={(e) => update(i, { weightKg: digitsOnly(e.target.value) })}
            inputMode="numeric"
            maxLength={4}
            placeholder="맨몸"
            className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-right"
          />
          <span className="text-sm text-gray-500">kg ×</span>
          <input
            aria-label={`${i + 1}세트 횟수`}
            value={row.reps}
            onChange={(e) => update(i, { reps: digitsOnly(e.target.value) })}
            inputMode="numeric"
            maxLength={4}
            className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-right"
          />
          <span className="text-sm text-gray-500">회</span>
          {/* 마지막 한 행은 지울 수 없다 — workoutSetsSchema가 .min(1)이다 */}
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`${i + 1}세트 삭제`}
              className="ml-auto shrink-0 text-xs text-gray-400 underline"
            >
              삭제
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={rows.length >= MAX_SETS}
        className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
      >
        세트 추가
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @daily/web test -- SetRows`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/workout/SetRows.tsx apps/web/src/pages/workout/SetRows.test.tsx
git commit -m "feat(web): 세트 입력 컴포넌트"
```

---

## Task 5: 운동 입력 폼

**Files:**
- Create: `apps/web/src/pages/workout/labels.ts`
- Create: `apps/web/src/pages/workout/WorkoutForm.tsx`
- Test: `apps/web/src/pages/workout/WorkoutForm.test.tsx`

**Interfaces:**
- Consumes: `WorkoutInput` (Task 3), `SetRows`·`toSets`·`toSetRows`·`emptySetRow`·`SetRow` (Task 4)
- Produces:
  - `labels.ts`: `BODY_PART_LABEL: Record<BodyPart, string>`, `INTENSITY_LABEL: Record<Intensity, string>`, `KIND_LABEL: Record<WorkoutKind, string>`
  - default export `WorkoutForm` — props `{ occurredOn: string; recentNames: string[]; initial?: LocalWorkout; onSubmit: (input: WorkoutInput) => Promise<void>; onCancel?: () => void }`

- [ ] **Step 1: 라벨 맵을 만든다**

`apps/web/src/pages/workout/labels.ts`

```ts
import type { BodyPart, Intensity, WorkoutKind } from '@daily/shared'

/**
 * 코드값 → 화면 라벨.
 *
 * DB에는 표시용 문자열을 넣지 않는다. `BODY_PART`·`INTENSITY`는 값 집합이
 * 코드에 있는 정적 코드라 `codes` 캐시(공통코드 테이블)를 거치지 않는다 —
 * 그쪽은 `BOOK_GENRE`처럼 런타임에 관리자가 바꾸는 값만 쓴다.
 *
 * `Record<BodyPart, string>`이라 코드값이 늘면 여기가 컴파일 에러로 따라온다.
 */
export const BODY_PART_LABEL: Record<BodyPart, string> = {
  CHEST: '가슴', BACK: '등', LEGS: '하체', SHOULDERS: '어깨',
  ARMS: '팔', CORE: '코어', FULL_BODY: '전신',
}

export const INTENSITY_LABEL: Record<Intensity, string> = {
  LOW: '가볍게', MID: '보통', HIGH: '힘들게',
}

export const KIND_LABEL: Record<WorkoutKind, string> = {
  STRENGTH: '근력', CARDIO: '유산소', ETC: '기타',
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/web/src/pages/workout/WorkoutForm.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LocalWorkout } from '../../db/index.ts'
import WorkoutForm from './WorkoutForm.tsx'

const TODAY = '2026-08-13'

function setup(over: Partial<Parameters<typeof WorkoutForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <WorkoutForm
      occurredOn={TODAY}
      recentNames={['벤치프레스', '스쿼트']}
      onSubmit={onSubmit}
      {...over}
    />,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('운동 폼', () => {
  it('근력을 세트와 함께 저장한다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '벤치프레스')
    await user.selectOptions(screen.getByLabelText('부위'), 'CHEST')
    await user.type(screen.getByLabelText('1세트 무게(kg)'), '60')
    await user.type(screen.getByLabelText('1세트 횟수'), '10')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
      bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }],
      durationMin: null, intensity: null, memo: null,
    })
  })

  it('유산소를 지속 시간과 함께 저장한다', async () => {
    const { onSubmit, user } = setup()

    await user.click(screen.getByRole('button', { name: '유산소' }))
    await user.type(screen.getByLabelText('종목'), '러닝')
    await user.type(screen.getByLabelText('시간(분)'), '30')
    await user.selectOptions(screen.getByLabelText('강도'), 'MID')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      occurredOn: TODAY, kind: 'CARDIO', name: '러닝', bodyPart: null,
      sets: null, durationMin: 30, intensity: 'MID', memo: null,
    })
  })

  /**
   * 근력으로 세트를 채우다 유산소로 바꾸고 저장하면 sets와 durationMin이
   * 함께 실려 zod에서 거부된다. 그 거부는 서버까지 갔다가 REJECTED로
   * 돌아오므로 사용자는 저장이 안 된 이유를 알 수 없다.
   */
  it('kind를 바꾸면 반대쪽 필드가 비워진다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('1세트 무게(kg)'), '60')
    await user.type(screen.getByLabelText('1세트 횟수'), '10')
    await user.click(screen.getByRole('button', { name: '유산소' }))
    await user.type(screen.getByLabelText('종목'), '러닝')
    await user.type(screen.getByLabelText('시간(분)'), '30')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sets: null }))

    // 근력으로 돌아가면 세트도 비어 있어야 한다.
    await user.click(screen.getByRole('button', { name: '근력' }))
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('')
  })

  it('맨몸 운동은 무게 없이 저장된다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '풀업')
    await user.type(screen.getByLabelText('1세트 횟수'), '12')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      sets: [{ reps: 12, weightKg: null }],
    }))
  })

  it('세트가 하나도 채워지지 않으면 저장하지 않고 알린다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '벤치프레스')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('세트')
  })

  it('최근 종목을 제안한다', () => {
    setup()
    expect(screen.getByRole('option', { name: '벤치프레스' })).toBeInTheDocument()
  })

  it('제안에 없는 종목도 그대로 입력된다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '케틀벨 스윙')
    await user.type(screen.getByLabelText('1세트 횟수'), '15')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '케틀벨 스윙' }))
  })

  it('수정 모드는 기존 값으로 시작한다', () => {
    const initial: LocalWorkout = {
      clientUuid: 'x', userId: 1, serverId: 1,
      occurredOn: TODAY, kind: 'STRENGTH', name: '스쿼트', bodyPart: 'LEGS',
      sets: [{ reps: 5, weightKg: 100 }], durationMin: null, intensity: 'HIGH',
      memo: '무거움', updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
    }
    setup({ initial })

    expect(screen.getByLabelText('종목')).toHaveValue('스쿼트')
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('100')
    expect(screen.getByLabelText('메모')).toHaveValue('무거움')
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm --filter @daily/web test -- WorkoutForm`
Expected: FAIL — `./WorkoutForm.tsx` 를 찾을 수 없음

- [ ] **Step 4: 폼을 구현한다**

`apps/web/src/pages/workout/WorkoutForm.tsx`

```tsx
import { useState, type FormEvent } from 'react'
import { BODY_PART, INTENSITY, type BodyPart, type Intensity } from '@daily/shared'
import type { LocalWorkout } from '../../db/index.ts'
import { BODY_PART_LABEL, INTENSITY_LABEL } from './labels.ts'
import SetRows, { emptySetRow, toSetRows, toSets, type SetRow } from './SetRows.tsx'
import type { WorkoutInput } from './repository.ts'

/**
 * 화면이 다루는 운동 종류는 둘뿐이다.
 *
 * 스키마와 DB CHECK에는 `ETC`가 있지만 폼에 넣지 않는다. 요구가 확인되면
 * 여기에 한 줄 더하는 것으로 끝난다 — `SCHEMA_VERSION`은 그대로다.
 */
const FORM_KINDS = [
  { value: 'STRENGTH', label: '근력' },
  { value: 'CARDIO', label: '유산소' },
] as const
type FormKind = (typeof FORM_KINDS)[number]['value']

const NAME_MAX = 100
const DURATION_MAX = 1440

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

interface Props {
  occurredOn: string
  recentNames: string[]
  initial?: LocalWorkout
  onSubmit: (input: WorkoutInput) => Promise<void>
  onCancel?: () => void
}

export default function WorkoutForm({
  occurredOn, recentNames, initial, onSubmit, onCancel,
}: Props) {
  const [kind, setKindState] = useState<FormKind>(
    initial?.kind === 'CARDIO' ? 'CARDIO' : 'STRENGTH',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [bodyPart, setBodyPart] = useState<string>(initial?.bodyPart ?? '')
  const [intensity, setIntensity] = useState<string>(initial?.intensity ?? '')
  const [rows, setRows] = useState<SetRow[]>(toSetRows(initial?.sets ?? null))
  const [durationMin, setDuration] = useState(
    initial?.durationMin === null || initial?.durationMin === undefined
      ? '' : String(initial.durationMin),
  )
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /**
   * kind를 바꾸면 반대쪽 필드를 비운다.
   *
   * 근력으로 세트를 채우다 유산소로 바꾸고 저장하면 `sets`와 `durationMin`이
   * 함께 실려 zod에서 거부된다. 그 거부는 서버까지 갔다가 REJECTED로 돌아오고,
   * 사용자에게는 "기록이 안 올라감"으로만 보인다. 폼 상태에서 막는다.
   */
  function setKind(next: FormKind) {
    if (next === kind) return
    setKindState(next)
    setRows([emptySetRow()])
    setDuration('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    if (trimmedName === '') {
      setError('종목을 입력해주세요.')
      return
    }

    const sets = kind === 'STRENGTH' ? toSets(rows) : null
    if (kind === 'STRENGTH' && sets!.length === 0) {
      setError('세트를 한 개 이상 입력해주세요.')
      return
    }
    if (kind === 'STRENGTH' && sets!.some((s) => !Number.isInteger(s.reps) || s.reps < 1)) {
      setError('세트의 횟수를 입력해주세요.')
      return
    }

    const duration = kind === 'CARDIO' ? Number(durationMin) : null
    if (kind === 'CARDIO' && (!duration || duration > DURATION_MAX)) {
      setError(`시간은 1분 이상 ${DURATION_MAX}분 이하여야 합니다.`)
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({
        occurredOn,
        kind,
        name: trimmedName,
        bodyPart: (bodyPart || null) as BodyPart | null,
        sets,
        durationMin: duration,
        intensity: (intensity || null) as Intensity | null,
        memo: memo.trim() || null,
      })
      // 수정 모드는 화면이 폼을 닫으므로 비우지 않는다.
      if (!initial) {
        setName('')
        setRows([emptySetRow()])
        setDuration('')
        setMemo('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
      <div className="flex gap-2">
        {FORM_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            aria-pressed={kind === k.value}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              kind === k.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">종목</span>
        {/* list는 제안일 뿐이다. 새 종목을 그대로 칠 수 있어야 한다 */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          list="workout-name-suggestions"
          maxLength={NAME_MAX}
          required
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <datalist id="workout-name-suggestions">
          {recentNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">부위</span>
          <select
            value={bodyPart}
            onChange={(e) => setBodyPart(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {BODY_PART.map((p) => (
              <option key={p} value={p}>{BODY_PART_LABEL[p]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">강도</span>
          <select
            value={intensity}
            onChange={(e) => setIntensity(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {INTENSITY.map((i) => (
              <option key={i} value={i}>{INTENSITY_LABEL[i]}</option>
            ))}
          </select>
        </label>
      </div>

      {kind === 'STRENGTH' ? (
        <SetRows rows={rows} onChange={setRows} />
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">시간(분)</span>
          <input
            value={durationMin}
            onChange={(e) => setDuration(digitsOnly(e.target.value))}
            inputMode="numeric"
            maxLength={4}
            required
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">메모</span>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={500}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-gray-700"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {initial ? '수정하기' : '기록하기'}
        </button>
      </div>
    </form>
  )
}
```

`<label>`이 감싸는 구조라 `getByLabelText('종목')`이 `<input>`을 찾는다. `1세트 무게(kg)`는 `SetRows`의 `aria-label`이다.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @daily/web test -- WorkoutForm`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/workout/labels.ts apps/web/src/pages/workout/WorkoutForm.tsx \
        apps/web/src/pages/workout/WorkoutForm.test.tsx
git commit -m "feat(web): 운동 입력 폼"
```

---

## Task 6: 운동 화면과 라우팅

**Files:**
- Create: `apps/web/src/pages/workout/WorkoutPage.tsx`
- Test: `apps/web/src/pages/workout/WorkoutPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/TabBar.tsx`

**Interfaces:**
- Consumes: `listWorkoutsByDate`·`listRecentNames`·`saveWorkout`·`deleteWorkout`·`WorkoutInput` (Task 3), `WorkoutForm` (Task 5), `BODY_PART_LABEL`·`INTENSITY_LABEL` (Task 5)
- Produces: default export `WorkoutPage` (props 없음), `/workouts` 라우트

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/workout/WorkoutPage.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { takeBatch } from '../../sync/outbox.ts'
import WorkoutPage from './WorkoutPage.tsx'

const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const TODAY = kstDate(new Date())

const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.workouts.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

const put = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
  ...over,
} as never)

describe('운동 화면', () => {
  it('그날의 기록을 보여준다', async () => {
    await put({ name: '벤치프레스' })
    await put({ occurredOn: '2026-01-01', name: '작년운동' })

    render(<WorkoutPage />)

    expect(await screen.findByText('벤치프레스')).toBeInTheDocument()
    expect(screen.queryByText('작년운동')).not.toBeInTheDocument()
  })

  it('근력은 세트를 요약해 보여준다', async () => {
    await put({ sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }] })

    render(<WorkoutPage />)

    // 맨몸 세트는 무게 없이 횟수만 보인다.
    expect(await screen.findByText('60kg×10, ×12')).toBeInTheDocument()
  })

  it('유산소는 시간과 강도를 보여준다', async () => {
    await put({
      kind: 'CARDIO', name: '러닝', bodyPart: null, sets: null,
      durationMin: 30, intensity: 'MID',
    })

    render(<WorkoutPage />)

    expect(await screen.findByText('30분 · 보통')).toBeInTheDocument()
  })

  it('기록이 없으면 안내를 보여준다', async () => {
    render(<WorkoutPage />)
    expect(await screen.findByText('기록이 없습니다.')).toBeInTheDocument()
  })

  /**
   * 폼 → repository → 아웃박스 페이로드까지 세트가 도달하는지 한 번에 본다.
   * 배선 중 하나가 빠지면 단위 테스트는 전부 통과하면서 기능만 조용히 깨진다.
   */
  it('입력한 세트가 아웃박스 페이로드까지 도달한다', async () => {
    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.type(await screen.findByLabelText('종목'), '데드리프트')
    await user.type(screen.getByLabelText('1세트 무게(kg)'), '100')
    await user.type(screen.getByLabelText('1세트 횟수'), '5')
    await user.click(screen.getByRole('button', { name: '세트 추가' }))
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    await waitFor(async () => {
      expect(await db.workouts.count()).toBe(1)
    })
    const [queued] = await takeBatch(1)
    expect(queued?.table).toBe('workouts')
    // [+ 세트]가 직전 값을 복사하므로 두 세트가 같은 값이어야 한다.
    expect((queued!.payload as { sets: unknown }).sets).toEqual([
      { reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 },
    ])
    expect(syncSoon).toHaveBeenCalled()
  })

  it('삭제하면 목록에서 빠지고 큐에 DELETE가 쌓인다', async () => {
    await put({ name: '벤치프레스', serverId: 7 })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.click(await screen.findByRole('button', { name: '벤치프레스 삭제' }))

    await waitFor(() => {
      expect(screen.queryByText('벤치프레스')).not.toBeInTheDocument()
    })
    const [queued] = await takeBatch(1)
    expect(queued?.op).toBe('DELETE')
  })

  it('수정하면 같은 레코드가 바뀐다', async () => {
    await put({ name: '벤치프레스' })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.click(await screen.findByRole('button', { name: '벤치프레스 수정' }))
    const nameInput = screen.getByLabelText('종목')
    await user.clear(nameInput)
    await user.type(nameInput, '인클라인 벤치프레스')
    await user.click(screen.getByRole('button', { name: '수정하기' }))

    await waitFor(async () => {
      expect(await db.workouts.count()).toBe(1)
    })
    expect(await screen.findByText('인클라인 벤치프레스')).toBeInTheDocument()
  })

  it('날짜를 바꾸면 그 날의 기록을 보여준다', async () => {
    await put({ occurredOn: '2026-08-01', name: '지난운동' })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.clear(screen.getByLabelText('날짜'))
    await user.type(screen.getByLabelText('날짜'), '2026-08-01')

    expect(await screen.findByText('지난운동')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @daily/web test -- WorkoutPage`
Expected: FAIL — `./WorkoutPage.tsx` 를 찾을 수 없음

- [ ] **Step 3: 화면을 구현한다**

`apps/web/src/pages/workout/WorkoutPage.tsx`

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { kstDate } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import type { LocalWorkout } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { BODY_PART_LABEL, INTENSITY_LABEL } from './labels.ts'
import WorkoutForm from './WorkoutForm.tsx'
import {
  deleteWorkout, listRecentNames, listWorkoutsByDate, saveWorkout,
  type WorkoutInput,
} from './repository.ts'

/** `60kg×10, ×12` — 맨몸 세트는 무게 없이 횟수만 적는다. */
function formatSets(sets: LocalWorkout['sets']): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .map((s) => (s.weightKg === null ? `×${s.reps}` : `${s.weightKg}kg×${s.reps}`))
    .join(', ')
}

function formatCardio(w: LocalWorkout): string {
  const parts = [`${w.durationMin}분`]
  if (w.intensity) parts.push(INTENSITY_LABEL[w.intensity])
  return parts.join(' · ')
}

export default function WorkoutPage() {
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const [occurredOn, setOccurredOn] = useState(() => kstDate(new Date()))
  const [editing, setEditing] = useState<LocalWorkout | null>(null)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 로컬 변경과 pull 결과를
  // 모두 반영하므로 저장 후 목록을 다시 불러오는 코드가 필요 없다.
  const workouts = useLiveQuery(
    () => listWorkoutsByDate(userId, occurredOn), [userId, occurredOn], [],
  )
  // 목록이 바뀌면 자동완성 후보도 따라 바뀐다.
  const recentNames = useLiveQuery(
    () => listRecentNames(userId), [userId, workouts], [],
  )

  async function handleSubmit(input: WorkoutInput) {
    await saveWorkout(userId, input, editing?.clientUuid)
    setEditing(null)
    // 큐에 넣은 직후 바로 보낸다. 온라인이면 사용자가 기다리지 않는다.
    syncSoon(userId)
  }

  async function handleDelete(clientUuid: string) {
    await deleteWorkout(userId, clientUuid)
    if (editing?.clientUuid === clientUuid) setEditing(null)
    syncSoon(userId)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">운동</h1>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 목록을 그대로 보여주면 부분만 보여 기록 유실로 오해한다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">날짜</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {/* key를 바꿔 수정 대상이 달라질 때 폼 상태를 새로 만든다. 없으면
          다른 기록의 수정 버튼을 눌러도 앞 기록의 값이 남는다 */}
      <WorkoutForm
        key={editing?.clientUuid ?? 'new'}
        occurredOn={occurredOn}
        recentNames={recentNames}
        initial={editing ?? undefined}
        onSubmit={handleSubmit}
        onCancel={editing ? () => setEditing(null) : undefined}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-600">{occurredOn}</h2>

        {workouts.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">기록이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workouts.map((w) => (
              <li
                key={w.clientUuid}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="text-gray-900">{w.name}</span>
                    {w.bodyPart && (
                      <span className="ml-2 text-gray-500">{BODY_PART_LABEL[w.bodyPart]}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {w.kind === 'CARDIO' ? formatCardio(w) : formatSets(w.sets)}
                  </p>
                  {w.memo && <p className="truncate text-xs text-gray-400">{w.memo}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(w)}
                    aria-label={`${w.name} 수정`}
                    className="text-xs text-gray-400 underline"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(w.clientUuid)}
                    aria-label={`${w.name} 삭제`}
                    className="text-xs text-gray-400 underline"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 4: 라우트와 탭을 배선한다**

`apps/web/src/App.tsx` — import를 더한다.

```tsx
import WorkoutPage from './pages/workout/WorkoutPage.tsx'
```

`/books` 라우트 아래에 더한다.

```tsx
            <Route path="/workouts" element={<><WorkoutPage /><TabBar /></>} />
```

`apps/web/src/components/TabBar.tsx` — `TABS`에 더하고 주석을 고친다.

```tsx
/**
 * 하단 탭 내비게이션.
 *
 * 일기·식사가 붙으면 이 배열에 한 줄씩 더한다. 화면 스택 안쪽
 * (책 상세 등)에서는 이 컴포넌트를 렌더링하지 않는다 — 다른 탭으로 바로
 * 나가면 돌아올 자리를 잃는다.
 */
const TABS = [
  { to: '/', label: '지출' },
  { to: '/books', label: '독서' },
  { to: '/workouts', label: '운동' },
] as const
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @daily/web test`
Expected: PASS (전체 스위트 — 기존 탭바 테스트가 있으면 함께 확인)

Run: `pnpm --filter @daily/web typecheck`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/workout/WorkoutPage.tsx \
        apps/web/src/pages/workout/WorkoutPage.test.tsx \
        apps/web/src/App.tsx apps/web/src/components/TabBar.tsx
git commit -m "feat(web): 운동 화면과 라우팅"
```

---

## Task 7: 전체 검증과 문서 갱신

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-06-daily-tracker-design.md` (현재 상태 언급이 있으면)

- [ ] **Step 1: 전체 스위트를 돌린다**

Run: `pnpm test`
Expected: 세 패키지 전부 PASS

Run: `pnpm typecheck`
Expected: 에러 없음

Run: `pnpm build`
Expected: 성공

실패가 있으면 여기서 고치고 커밋한다. 통과할 때까지 다음 단계로 가지 않는다.

- [ ] **Step 2: `CLAUDE.md`의 현재 상태를 고친다**

"현재 상태" 문단을 고친다.

```markdown
설계 확정. 1단계(기반·인증) 완료. 2단계는 동기화 엔진 + 지출 + 독서 + 운동까지 완료, 일기·식사 미착수.
```

설계 문서 목록에 한 줄 더한다.

```markdown
운동: [2026-08-13-workout-tracking-design.md](docs/superpowers/specs/2026-08-13-workout-tracking-design.md)
```

상태 표의 해당 행을 고친다.

```markdown
| 운동 기록 화면 (근력 세트 JSONB) | 완료 |
| 일기·식사 | 미착수 |
```

(기존 `| 일기·식사·운동 | 미착수 |` 행을 위 두 줄로 바꾼다.)

- [ ] **Step 3: 배포 노트를 남긴다**

`CLAUDE.md`의 현재 상태 표 아래에 한 줄 더한다.

```markdown
> **배포 주의:** `SCHEMA_VERSION` 4다. API를 먼저 배포하고 웹을 나중에 올린다. 반대 순서면 기존 사용자가 409 `SERVER_OUTDATED`를 받는다.
```

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: 운동 기록 완료를 현재 상태에 반영"
```

---

## 자체 검토 결과

계획을 쓴 뒤 스펙과 대조해 확인한 것들이다.

**스펙 커버리지** — §3 페이로드(Task 1), §3 `SCHEMA_VERSION`(Task 2 Step 4), §4 레지스트리·`JSONB` 경로(Task 2 Step 5 + 서버 테스트), §5 Dexie·apply(Task 2 Step 6–7), §6 목록·폼·세트·자동완성(Task 3–6), §7 삭제 규칙(Task 3 테스트), §8 테스트(각 태스크에 분산), §9 구현 순서(태스크 순서), §10 범위 제외(`ETC`는 스키마만·화면 없음으로 Task 5에 반영). 빠진 요구사항은 없다.

**타입 일관성** — `WorkoutInput`(repository)과 `WorkoutPayload`(shared)는 필드 이름·타입이 같다. `SetRow`는 폼 전용 문자열 타입이고 `toSets`가 경계에서 변환한다. `LocalWorkout`은 `WorkoutInput` + `LocalRecord`다. `listRecentNames`는 Task 3에서 정의하고 Task 5·6이 `recentNames: string[]`로 받는다.

**남아 있는 리스크** — Task 6의 `recentNames` `useLiveQuery`가 `workouts` 배열을 의존성으로 받는다. 목록이 바뀔 때마다 재조회하므로 정확하지만, 기록이 많아지면 200행 스캔이 매번 돈다. 체감 문제가 생기면 의존성을 `occurredOn`으로 좁힌다 — 그때 자동완성이 한 박자 늦게 갱신되는 것은 감수할 만하다.
