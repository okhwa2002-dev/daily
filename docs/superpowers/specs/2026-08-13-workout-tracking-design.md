# 운동 기록 설계

작성일: 2026-08-13

---

## 1. 목표

날짜별로 운동을 기록하는 화면을 추가한다. `workouts`는 하루 여러 건이고, 한 건이 한 종목이다 — "2026-08-13에 벤치프레스, 러닝"은 두 행이다.

DB 테이블(`workouts`)·인덱스·`CHECK`·컬럼 코멘트는 1단계에서 이미 만들어져 있고 마이그레이션(`0001_chunky_iron_patriot.sql`)도 적용되어 있다. 코드값 `WORKOUT_KIND`·`BODY_PART`·`INTENSITY`와 세트 zod 스키마(`workoutSetSchema`)도 있다. **이 설계가 다루는 것은 그 위의 페이로드 스키마, 동기화 배선, 화면이다. DB 작업은 없다.**

### 지출과 같은 모양으로 간다

운동은 "그날 뭘 했나"가 중심이라 지출과 성격이 같다. 독서처럼 목록·상세로 나누지 않고 `ExpensePage`와 같은 날짜별 단일 화면으로 만든다. 부모-자식 참조도 없다 — 세트는 자식 테이블이 아니라 `JSONB` 값 덩어리다.

그래서 이번 작업에는 새로운 동기화 개념이 없다. 독서에서 검증한 `CONFLICT` 경로도, 지출의 `required: false` 부모 참조도 쓰지 않는다. 새로운 것은 **`JSONB` 페이로드를 처음 실어 나른다**는 것 하나다.

---

## 2. 파일 구조

```
packages/shared/src/
└── workout.ts                  workoutSetsSchema (기존) + workoutPayloadSchema (신규)

apps/api/src/sync/
└── registry.ts                 workouts 항목 추가

apps/web/src/
├── db/index.ts                 LocalWorkout + version(5)
├── sync/apply.ts               APPLIERS / SERVER_ID_STORES 항목 추가
├── components/TabBar.tsx       지출 / 독서 / 운동
└── pages/workout/
    ├── WorkoutPage.tsx         날짜 네비 + 그날 목록 + 추가/수정
    ├── WorkoutForm.tsx         kind 선택 + 공통 필드
    ├── SetRows.tsx             세트 행 반복 입력
    └── repository.ts           Dexie 읽기/쓰기 + 아웃박스 적재
```

`pages/<기능>/` 규칙을 그대로 따른다. `pages/workout/`은 `pages/expense/`를 임포트하지 않는다.

`SetRows`를 `WorkoutForm`에서 분리하는 이유는 상태의 성격이 다르기 때문이다. 폼의 나머지는 필드 하나에 값 하나지만, 세트는 길이가 변하는 배열이고 행 추가·복사·삭제가 붙는다. 한 파일에 두면 폼 컴포넌트가 세트 배열 조작 로직으로 덮인다.

### 라우팅

| 경로 | 화면 | 탭바 |
|---|---|---|
| `/` | `ExpensePage` | 있음 |
| `/books` | `BookListPage` | 있음 |
| `/books/:clientUuid` | `BookDetailPage` | 없음 |
| **`/workouts`** | **`WorkoutPage`** | **있음** |

---

## 3. shared 스키마

`workoutPayloadSchema`는 `kind`로 갈라지는 discriminated union이다. DB `workouts_shape_ck`와 **같은 규칙**을 표현한다.

```ts
const base = {
  occurredOn: occurredOnSchema,
  name: z.string().trim().min(1).max(100),
  bodyPart: z.enum(BODY_PART).nullable().default(null),
  intensity: z.enum(INTENSITY).nullable().default(null),
  memo: z.string().max(500).nullable().default(null),
}

export const workoutPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('STRENGTH'),
    sets: workoutSetsSchema,
    durationMin: z.null().default(null),
  }).strict(),
  z.object({
    ...base,
    kind: z.literal('CARDIO'),
    sets: z.null().default(null),
    durationMin: z.number().int().positive().max(1440),
  }).strict(),
  z.object({
    ...base,
    kind: z.literal('ETC'),
    sets: workoutSetsSchema.nullable().default(null),
    durationMin: z.number().int().positive().max(1440).nullable().default(null),
  }).strict(),
])
```

| kind | `sets` | `duration_min` |
|---|---|---|
| `STRENGTH` | 필수 (1~50개) | `null` 고정 |
| `CARDIO` | `null` 고정 | 필수 (1~1440) |
| `ETC` | 선택 | 선택 |

`z.null()`을 쓰는 것이 핵심이다. 그 필드를 생략하는 것이 아니라 **`null`만 허용**한다. `.strict()`와 합쳐지면 `kind: 'CARDIO'`인데 `sets`를 실어 보내는 요청이 zod에서 걸린다. 필드를 union에서 아예 빼면 `.strict()`가 "모르는 키"로 거부하므로 결과는 같지만, 이 형태가 DB `CHECK`와 눈으로 대조된다.

`durationMin` 상한 1440분은 하루다. 상한이 없으면 오타 하나가 그대로 저장된다.

### ETC를 화면에서 빼되 스키마에는 남긴다

**화면은 `STRENGTH`와 `CARDIO`만 제공한다.** `ETC`를 고를 방법이 없으므로 이 값을 가진 행은 생기지 않는다.

그래도 union에는 남긴다. shared의 zod가 DB `CHECK`의 거울이라는 것이 [전체 설계](2026-08-06-daily-tracker-design.md) §데이터 모델의 규칙이고, `workouts_shape_ck`는 이미 세 분기다. 한쪽만 두 분기로 두면 다음에 읽는 사람이 어느 쪽이 맞는지 판단할 근거를 잃는다.

실질적인 이득도 있다. 나중에 ETC 입력을 붙일 때 화면만 고치면 되고 `SCHEMA_VERSION`을 다시 올리지 않는다 — 버전을 올리면 구버전 PWA 전체가 426을 받고 갱신을 거쳐야 한다. 그 비용을 피할 수 있을 때 피한다.

### `SCHEMA_VERSION`을 4로 올린다

`SYNC_TABLE`에 `'workouts'`를 더하면서 `SCHEMA_VERSION`을 3에서 4로 올린다.

이 게이트가 없으면 구버전 클라이언트가 pull에서 `workouts` 행을 받고, `APPLIERS['workouts']`가 `undefined`라 동기화 루프가 예외로 죽는다. pull 커서는 그 지점에서 전진하지 못하고, 그 기기는 이후 **어떤** 변경도 받지 못한다. 사용자에게는 "다른 기기에서 쓴 게 안 보임"으로만 보인다.

**배포 순서는 API가 먼저다.** 웹을 먼저 올리면 신버전 클라이언트가 `schemaVersion: 4`를 보내고 구버전 서버가 409 `SERVER_OUTDATED`를 돌려준다. 반대 순서면 구버전 클라이언트가 426을 받아 Service Worker 갱신으로 유도되므로, 사용자가 새로고침 한 번으로 정상화된다. 배포 노트에 남긴다.

---

## 4. 서버 동기화 레지스트리

[registry.ts](../../../apps/api/src/sync/registry.ts)에 항목 하나를 더한다.

```ts
workouts: define<WorkoutPayload>({
  table: workouts,
  payload: workoutPayloadSchema,
  hasOccurredOn: true,
  toColumns: (p) => ({
    occurredOn: p.occurredOn,
    kind: p.kind,
    name: p.name,
    bodyPart: p.bodyPart,
    sets: p.sets,
    durationMin: p.durationMin,
    intensity: p.intensity,
    memo: p.memo,
  }),
  toPayload: (r) => ({ /* 같은 필드 역방향 */ }),
}),
```

`parent`는 없다. 세트는 자식 테이블이 아니므로 참조를 풀 일이 없다.

`validate`도 없다. 이 훅은 "zod로 막을 수 없는 것"만 오는 자리인데, 운동의 코드값은 전부 `codes.ts`의 정적 집합이라 `z.enum`으로 막힌다. `BOOK_GENRE`가 `validate`를 쓰는 것은 값 집합이 DB의 `codes` 테이블에 있어서다. 운동은 그 경우가 아니다.

push·pull은 `SYNC_REGISTRY`를 순회하므로 이 항목 하나로 양쪽이 함께 따라온다.

### `sets`가 `JSONB`로 오가는 경로

이번 작업에서 처음 하는 일이라 명시해 둔다.

```
폼 상태 WorkoutSet[]
  → repository가 payload.sets에 그대로 담아 outbox에 적재
  → push 본문 JSON
  → 서버 zod(workoutSetsSchema)가 모양 검증
  → drizzle jsonb 컬럼에 저장
  → pull에서 객체 배열 그대로 내려옴
  → apply.ts가 LocalWorkout.sets에 반영
```

문자열로 직렬화하는 단계가 어디에도 없다. `jsonb('sets').$type<WorkoutSet[]>()`이 드라이버 수준에서 객체를 다루므로, 손으로 `JSON.stringify`를 끼워 넣으면 DB에 따옴표로 감싼 문자열이 들어가고 `CHECK`는 그걸 막지 못한다.

**`JSONB`의 모양은 DB가 막을 수 없다.** `workouts_shape_ck`는 `sets IS NOT NULL`까지만 본다. 배열인지, 원소에 `reps`가 있는지는 보지 않는다. 서버 진입 시점의 `workoutSetsSchema`가 유일한 방어선이다.

---

## 5. 로컬 저장소 (Dexie version 5)

```ts
export interface LocalWorkout extends LocalRecord {
  occurredOn: string
  kind: WorkoutKind
  name: string
  bodyPart: BodyPart | null
  sets: WorkoutSet[] | null
  durationMin: number | null
  intensity: Intensity | null
  memo: string | null
}
```

```ts
this.version(5).stores({
  workouts: 'clientUuid, userId, [userId+occurredOn]',
})
```

`deletedAt`은 인덱스에 넣지 않는다. IndexedDB가 `null`을 키로 쓰지 못해, 넣으면 살아있는 레코드가 인덱스에서 통째로 빠진다 — version 2·3과 같은 이유다. 살아있는 행 걸러내기는 `repository.ts`의 `live()`가 JS에서 한다.

**자동완성용 인덱스는 만들지 않는다.** `name` 인덱스를 걸어도 필요한 것은 "최근에 쓴 순서"라 그 인덱스로는 답이 안 나온다. `[userId+occurredOn]`을 최근 쪽부터 훑어 distinct `name`을 뽑는 것으로 충분하다 (§6 종목 자동완성).

`apply.ts`의 `APPLIERS`와 `SERVER_ID_STORES`에도 항목을 더한다. 둘 다 `Record<SyncTable, …>`이라 `SYNC_TABLE`에 `'workouts'`를 넣는 순간 컴파일 에러로 빠뜨린 자리가 드러난다. 이 강제가 이 설계에서 손으로 챙길 배선을 셋(shared·registry·apply)으로 줄여 준다.

`clearLocalData`는 `db.tables`를 순회하므로 손댈 곳이 없다.

---

## 6. 화면

### 날짜별 목록 (`/workouts`)

`ExpensePage`와 같은 뼈대다. 상단에 날짜 입력(`kstDate(new Date())`로 초기화), 그 아래 그날의 운동 목록, 하단에 추가 폼.

목록의 한 줄에 보이는 것:

| kind | 표시 |
|---|---|
| `STRENGTH` | 종목명 · 부위 라벨 / `60kg×10, 60kg×8, 50kg×10` |
| `CARDIO` | 종목명 / `30분 · 강도 보통` |

무게가 `null`인 세트(맨몸)는 `×12`처럼 횟수만 보인다.

코드값의 한글 라벨은 프론트에서 매핑한다. `BODY_PART`·`INTENSITY`는 `codes` 캐시가 아니라 정적 코드이므로, `pages/workout/` 안에 라벨 맵을 둔다. 다른 기능이 쓰기 시작하면 그때 공용 자리로 뽑는다.

### 폼 (`WorkoutForm`)

`kind`를 먼저 고르고, 그에 따라 아래 필드가 바뀐다.

```
kind   [ 근력 | 유산소 ]        ← 두 개짜리 토글
종목   [ 벤치프레스        ]    ← list= 로 최근 종목 제안
부위   [ 가슴 ▾ ]  강도 [ 보통 ▾ ]

── kind=근력 ──          ── kind=유산소 ──
 ① [60]kg × [10]회  ✕     시간 [ 30 ] 분
 ② [60]kg × [ 8]회  ✕
    [ + 세트 ]

메모   [                  ]
```

**`kind`를 바꾸면 반대쪽 필드를 비운다.** 근력으로 세트를 채우다 유산소로 바꾸고 저장하면 `sets`와 `durationMin`이 함께 실려 zod에서 거부된다. 그 거부는 서버까지 갔다가 `REJECTED`로 돌아오므로 사용자는 저장이 안 된 이유를 알 수 없다. 폼 상태 수준에서 막는다.

### 세트 입력 (`SetRows`)

- `[+ 세트]`는 **마지막 행의 무게·횟수를 복사해** 새 행을 만든다. 근력 운동은 세트 간 값이 거의 같아 탭 수가 크게 준다. 첫 행은 빈 값이다.
- 각 행에 삭제 버튼이 있다. 마지막 한 행은 지울 수 없다 — `workoutSetsSchema`가 `.min(1)`이다.
- 상한은 50개다. 도달하면 `[+ 세트]`를 비활성화한다.
- 저장 시 **무게·횟수가 모두 빈 행은 버린다.** 복사해 놓고 안 채운 행이 그대로 실려 나가면 `reps`가 `positive()`에서 걸린다.
- 무게 칸이 비어 있고 횟수만 있으면 `weightKg: null`(맨몸)이다. 빈 칸을 `0`으로 바꾸지 않는다 — `0kg`과 "무게 없음"은 다르고, 스키마가 둘 다 허용하므로 저장까지 통과해 버린다.

### 종목 자동완성

`repository.listRecentNames(userId, limit)`가 `[userId+occurredOn]`을 최근 날짜부터 역순으로 훑어 살아있는 행의 `name`을 중복 없이 모은다. 최근 90일 또는 200행 중 먼저 닿는 쪽에서 멈춘다 — 상한이 없으면 기록이 쌓일수록 폼을 열 때마다 전체 테이블을 읽는다.

`<input list>` + `<datalist>`로 붙인다. 자유 입력이 여전히 가능해야 한다. 새 종목을 못 넣게 되면 `name`이 자유 입력이라는 전제가 깨진다.

[전체 설계](2026-08-06-daily-tracker-design.md) §범위 제외가 "운동 종목 마스터 테이블 대신 자유 입력 + 최근 사용 자동완성"으로 적어 둔 자리를 채우는 것이다.

### 데이터 접근

화면은 `repository.ts`만 부른다. API를 직접 호출하지 않는다.

```
listWorkoutsByDate(userId, occurredOn)   그날의 살아있는 행
listRecentNames(userId, limit)           자동완성 후보
saveWorkout(userId, input, clientUuid?)  put + enqueue (한 트랜잭션)
deleteWorkout(userId, clientUuid)        툼스톤 + enqueue
```

`saveWorkout`은 `saveExpense`와 같이 레코드 쓰기와 아웃박스 적재를 한 트랜잭션에 묶는다. 레코드만 쓰이고 큐 적재가 실패하면 그 기록은 이 기기에만 남아 영영 서버로 가지 않는다.

---

## 7. 삭제 규칙

`deleteWorkout`은 툼스톤을 남긴다(`deletedAt` 설정 + `op: 'DELETE'` 적재). 물리 삭제하면 삭제가 다른 기기로 전파되지 않아 지운 기록이 되살아난다.

세트 하나를 지우는 것은 삭제가 아니라 **운동 행의 수정**이다. `sets` 배열이 바뀐 `UPSERT`로 나간다. 동기화 단위가 1레코드로 유지되는 것이 `JSONB` 선택의 목적이었다.

---

## 8. 테스트

TDD로 진행한다. 각 항목은 실패하는 테스트를 먼저 쓴다.

**shared** (`workout.test.ts`)
- `STRENGTH`에 `durationMin`을 실으면 거부된다
- `CARDIO`에 `sets`를 실으면 거부된다
- `CARDIO`에 `durationMin`이 없으면 거부된다
- `sets`가 빈 배열이거나 51개면 거부된다
- `weightKg: null`(맨몸)은 통과한다
- 모르는 키는 `.strict()`에서 거부된다

**api** (`sync.test.ts`에 추가)
- `workouts` UPSERT가 `sets`를 `JSONB`로 저장하고, pull에서 객체 배열 그대로 내려온다
- 잘못된 모양의 `sets`(`reps` 없음)가 `REJECTED`로 돌아온다 — 500이 아니다. 500은 재시도 대상이라 큐가 그 항목에서 막힌다
- 남의 `client_uuid`로는 남의 행을 건드리지 못한다

**web repository** (`repository.test.ts`)
- 저장이 레코드와 아웃박스에 동시에 남는다
- 삭제가 툼스톤을 남기고 조회에서 빠진다
- `listRecentNames`가 최근순·중복 없이 돌려주고, 삭제된 행의 종목은 빼고, 상한에서 멈춘다

**web 화면** (`WorkoutPage.test.tsx`)
- `[+ 세트]`가 마지막 행 값을 복사한다
- `kind`를 바꾸면 반대쪽 필드가 비워진다
- 빈 세트 행은 저장에서 빠진다
- 무게를 비우면 `weightKg: null`로 저장된다 (`0`이 아니다)

**통합** — 독서에서 장르로 했던 것과 같은 성격으로, **세트가 폼 → 아웃박스 페이로드 → 서버 → pull → 로컬 반영까지 도달하는지** 한 테스트로 확인한다. 배선 세 곳 중 하나를 빠뜨렸을 때 단위 테스트는 전부 통과하면서 기능만 조용히 깨지는 것을 막는다.

---

## 9. 구현 순서

1. `workoutPayloadSchema` + 테스트 (shared)
2. `SYNC_TABLE`에 `'workouts'`, `SCHEMA_VERSION` 4 — 여기서 api·web 양쪽에 컴파일 에러가 뜬다
3. `registry.ts` 항목 + 서버 테스트
4. Dexie `LocalWorkout`·`version(5)`, `apply.ts` 항목
5. `repository.ts` + 테스트
6. `SetRows` → `WorkoutForm` → `WorkoutPage`
7. 라우트·탭바
8. 통합 테스트
9. `CLAUDE.md` 현재 상태 표 갱신

2번을 앞에 두는 것이 의도다. 타입 시스템이 남은 배선 지점을 먼저 전부 드러내므로, 이후 단계에서 빠뜨릴 자리가 없다.

---

## 10. 범위에서 제외

| 항목 | 이유 |
|---|---|
| `ETC` 입력 화면 | 스키마에는 있으나 폼에 넣지 않는다. 필요해지면 화면만 고친다 |
| 직전 기록 불러오기 | 세트 복사로 입력 부담이 이미 줄어든다. 겹치는 기능을 둘 만들지 않는다 |
| 운동 통계·그래프 | 통계는 여러 기능 데이터를 묶는 별도 작업이다. 운동만 따로 만들면 다시 만들게 된다 |
| 운동 종목 마스터 테이블 | 자유 입력 + 자동완성으로 충분하다. 전체 설계의 판단을 유지한다 |
| 세트별 휴식 시간·RPE | 요구가 확인되지 않았다. `sets` 원소에 필드를 더하는 것은 나중에도 가능하다 |
| 세트를 별도 테이블로 승격 | "60kg 이상 든 날" 같은 SQL 조회 요구가 실제로 생기면 그때 한다 |
