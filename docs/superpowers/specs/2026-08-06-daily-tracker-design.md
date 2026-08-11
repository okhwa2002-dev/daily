# Daily Tracker — 설계 문서

작성일: 2026-08-06

---

## 1. 개요

지출·운동·식사·일기·독서를 기록하는 일일 기록 서비스.
불특정 다수를 대상으로 하는 공개 웹 서비스이며, 네트워크가 없는 환경에서도 기록할 수 있어야 한다.

### 확정된 전제

| 항목 | 결정 |
|---|---|
| 형태 | 모바일 웹 PWA (설치 가능) |
| 대상 | 불특정 다수 (공개 서비스) |
| 오프라인 | 오프라인 입력 후 동기화 |
| 인증 | 아이디(`login_id`) + 비밀번호 자체 구현. 이메일은 계정 복구용으로 필수 수집 |
| 인프라 | VPS 직접 운영 (nginx + PM2) |
| 초기 규모 | 수십~수백 명 (검증 단계) |

### 설계를 지배하는 제약

**오프라인 입력 지원**이 다른 모든 결정을 좌우한다. 이 제약 때문에 다음이 따라온다.

- 프론트는 화면이 아니라 "로컬 DB를 가진 클라이언트"가 된다
- ID를 서버 채번에만 의존할 수 없다 → `client_uuid` 도입
- 삭제를 물리 삭제로 할 수 없다 → 툼스톤 필수
- 충돌 해결 정책이 필요하다 → 레코드 단위 last-write-wins

---

## 2. 기술 스택

| 영역 | 선택 | 선정 이유 |
|---|---|---|
| 프론트 | React 19 + TypeScript + Vite | Dexie 공식 `useLiveQuery` 지원, 기존 자산 활용 |
| 로컬 저장소 | Dexie (IndexedDB) | 화면의 유일한 데이터 소스 |
| 상태 관리 | Zustand | UI·세션 상태 전용 |
| 스타일 | Tailwind CSS v4 | 모바일 우선 |
| PWA | vite-plugin-pwa (Workbox) | 앱 셸 캐싱, 홈 화면 설치 |
| 차트 | Recharts | 통계 화면 |
| 폼 | react-hook-form + zod | shared 스키마 재사용 |
| 백엔드 | Node 22 LTS + TypeScript + Fastify | 스키마 기반 검증 내장 — 동기화 페이로드 검증에 유리 |
| DB 접근 | Drizzle ORM + drizzle-kit | SQL에 가까운 표현 + 타입 안전 + 마이그레이션 |
| 검증 | zod | 프론트/백엔드 공유 |
| 로깅 | pino | |
| DB | PostgreSQL 18 | |
| 메일 | Resend 또는 AWS SES | 자체 SMTP는 스팸 처리되어 사용 불가 |
| 패키지 | pnpm workspace | |
| 배포 | nginx + PM2 | 기존 운영 방식과 동일 |

### 도입하지 않는 것

Redis, 메시지 큐, Docker/K8s 배포, 마이크로서비스, GraphQL, 전용 동기화 엔진(RxDB/PowerSync/ElectricSQL), 웹소켓.

초기 규모에서 전부 순수 비용이다. 필요해지는 시점에 다시 판단한다.

### 검토했으나 선택하지 않은 대안

| 대안 | 기각 이유 |
|---|---|
| Next.js 풀스택 | 오프라인 우선과 SSR이 충돌한다. 서버 렌더 결과와 로컬 DB 상태가 어긋나 결국 대부분을 클라이언트 컴포넌트로 돌리게 되어 이점이 사라진다 |
| 관리형 플랫폼 (Vercel/Supabase) | 인프라를 직접 운영하기로 결정 |
| 전용 동기화 엔진 | 운영 대상이 늘고 학습 곡선이 있다. 수백 명 규모가 정당화하지 못한다. 충돌이 실제 문제가 되면 그때 도입 |
| Vue 3 | Dexie 반응형 연동이 공식 지원이 아닌 우회 경로(`@vueuse/rxjs`)다. 기존 React 자산도 있다 |

---

## 3. 아키텍처

```
[브라우저 PWA]
   React UI ── 읽기/쓰기 ──> Dexie (IndexedDB)   ← 화면이 보는 유일한 데이터 소스
                              │
                              └── outbox 큐 ──> [nginx :443]
                                                  ├─ /        → 정적 SPA 빌드
                                                  └─ /api/*   → Fastify (PM2, :3001)
                                                                     │
                                                                PostgreSQL 18
```

### 핵심 원칙: UI는 Dexie만 읽는다

화면 컴포넌트는 API를 직접 호출하지 않는다. 읽기·쓰기 모두 로컬 Dexie를 거치고, 서버 통신은 `sync/` 계층이 전담한다. 예외는 인증(로그인/회원가입)뿐이다.

온라인일 때만 서버에서 직접 읽는 최적화는 넣지 않는다. 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너지고, 오프라인 분기 코드가 화면 전체로 번진다.

### 디렉터리 구조

```
daily/
├── apps/
│   ├── web/                    # Vite + React PWA
│   │   ├── src/
│   │   │   ├── db/             # Dexie 스키마, outbox 테이블
│   │   │   ├── sync/           # 동기화 엔진 (push/pull, 재시도, 온라인 감지)
│   │   │   ├── store/          # Zustand — UI 상태
│   │   │   ├── components/     # 공용 UI
│   │   │   ├── pages/          # 기능별 폴더 — expense/ workout/ meal/ …
│   │   │   └── lib/
│   │   └── vite.config.ts
│   └── api/                    # Fastify 서버
│       ├── src/
│       │   ├── routes/
│       │   ├── db/             # drizzle 스키마, 마이그레이션
│       │   ├── services/       # 도메인 로직
│       │   └── plugins/        # auth, rate-limit, error-handler
│       └── drizzle.config.ts
├── packages/
│   └── shared/                 # zod 스키마 + 도메인 타입
└── docs/
```

`packages/shared`가 이 구조의 값어치다. 레코드의 모양을 zod 스키마로 한 곳에만 정의하고, 프론트 폼 검증·백엔드 요청 검증·양쪽 타입 추론이 전부 여기서 파생된다. 스키마를 고치면 어긋난 쪽이 컴파일 에러로 잡힌다.

`pages/<기능>/` 단위 분리는 지출·운동·식사·일기·독서가 서로 독립적이기 때문이다. 각 폴더가 자기 화면·부품·로컬 쿼리를 소유해 한 기능을 고칠 때 다른 기능을 건드리지 않는다.

### 배포

- 프론트: `pnpm build` → `dist/`를 서버로 복사, nginx 정적 서빙. 롤백은 심볼릭 링크 전환
- API: PM2 (`ecosystem.config.cjs`). 배포 전 `drizzle-kit migrate` 실행
- 환경변수: `.env`(git 제외) + `.env.example`(커밋)
- 백업: `pg_dump` 일 1회 cron, 보관 7일

---

## 4. 데이터 모델

### 공통 컬럼

모든 도메인 테이블이 갖는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | 서버 채번 |
| `client_uuid` | `UUID NOT NULL` | 클라이언트 생성. 동기화 식별자 |
| `user_id` | `BIGINT NOT NULL` | 소유자 |
| `created_at` / `created_by` | `TIMESTAMP` / `BIGINT` | 등록 일시 · 등록자 |
| `updated_at` / `updated_by` | `TIMESTAMP` / `BIGINT` | 수정 일시 · 수정자 (충돌 판정 기준) |
| `deleted_at` / `deleted_by` | `TIMESTAMP NULL` / `BIGINT NULL` | 소프트 삭제 |
| `synced_at` | `TIMESTAMP NOT NULL` | 서버가 찍는 pull 커서 |

기록 테이블은 추가로 `occurred_on DATE NOT NULL`(기록 대상 날짜)을 갖는다.

**`_at` 컬럼을 만들면 짝이 되는 `_by`를 반드시 함께 만들고 해당 사용자 ID를 넣는다.**

마스터 데이터 테이블(`books`, `expense_categories`)은 특정 날짜의 기록이 아니므로 `occurred_on`이 없다. 이 둘이 유일한 예외다.

### id와 client_uuid의 역할 분리

| | 용도 |
|---|---|
| `id` (BIGSERIAL) | DB 내부 식별자, FK, 인덱스 |
| `client_uuid` (UUID) | 동기화 식별자. 오프라인 생성, 중복 전송 방지 |

오프라인에서 생성한 레코드는 서버 `id`를 받을 수 없으므로 `client_uuid`가 필요하다. 서버는 `ON CONFLICT (user_id, client_uuid)`로 업서트하여 재전송 시에도 중복 행을 만들지 않는다.

로컬에서 레코드 간 참조는 `client_uuid`로 하고, 전송 시점에 `id`로 치환한다. 이 변환은 `sync/` 계층 안에만 존재하며 화면 코드로 새어나가지 않는다.

### 날짜와 시각

- 시각 컬럼은 `TIMESTAMP`(타임존 없음)로 **KST 로컬 시각**을 저장한다. `TIMESTAMPTZ`는 사용하지 않는다
- 클라이언트가 보낸 `updated_at`은 서버 진입 시점에 KST로 정규화한다. 정규화를 빠뜨리면 기기 타임존이 다를 때 최신 판정이 뒤집힌다
- `synced_at`은 서버가 직접 찍는다. 클라이언트 시계를 신뢰하지 않는다
- 사용자가 보는 날짜는 전부 `occurred_on DATE`다. 타임존 영향을 받지 않는다

알려진 한계: 해외 체류 사용자의 `created_at`은 "누구 기준 시각인지" 모호해진다. 다만 화면에 표시되는 날짜는 모두 `occurred_on`이라 사용자 경험에는 영향이 없다. 국내 서비스 전제로 KST 단일 기준을 유지한다.

### 도메인 테이블

**`expenses`** — 하루 여러 건

| 컬럼 | 타입 |
|---|---|
| `kind` | `TEXT` — `INCOME` \| `EXPENSE` |
| `amount` | `NUMERIC(12,2)` — 부호는 `kind`가 가지므로 음수를 허용하지 않는다 |
| `category_id` | `BIGINT NULL` → `expense_categories`. 미분류면 NULL |
| `category_client_uuid` | `UUID NULL` — 동기화용 부모 참조 (아래 "부모-자식 동기화") |
| `memo` | `TEXT NULL` |

**`workouts`** — 하루 여러 건

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `kind` | `TEXT` | `STRENGTH` \| `CARDIO` \| `ETC` |
| `name` | `TEXT` | 운동 종류 |
| `body_part` | `TEXT NULL` | `CHEST`/`BACK`/`LEGS`/`SHOULDERS`/`ARMS`/`CORE`/`FULL_BODY` |
| `sets` | `JSONB NULL` | `[{ "reps": 10, "weightKg": 60 }, ...]` |
| `duration_min` | `INT NULL` | 유산소·기타 |
| `intensity` | `TEXT NULL` | `LOW`/`MID`/`HIGH` |
| `memo` | `TEXT NULL` | |

세트를 자식 테이블로 분리하지 않고 `JSONB`에 담는 이유: 세트는 해당 운동에서만 의미가 있고, 독립 조회·참조되지 않으며, 항상 운동과 함께 수정된다. 별개 엔티티가 아니라 값 덩어리다. 이렇게 두면 **동기화 단위가 정확히 1레코드로 유지**되어, 부분 동기화된 상태(운동은 전송되고 세트는 안 됨)가 발생하지 않는다.

`kind`에 따라 채워지는 필드가 달라지므로 zod discriminated union으로 검증하고, `CHECK` 제약으로 DB에서도 막는다.

한계: SQL에서 세트를 직접 필터링하는 쿼리(예: "60kg 이상 든 날")는 일반 컬럼보다 번거롭다. 그런 조회 니즈가 실제로 생기면 별도 테이블로 승격한다.

**`meals`** — 하루 여러 건

| 컬럼 | 타입 |
|---|---|
| `slot` | `TEXT` — `BREAKFAST`/`LUNCH`/`DINNER`/`SNACK` |
| `description` | `TEXT` — 먹은 것 |
| `portion` | `TEXT` — `LIGHT`/`NORMAL`/`HEAVY` |
| `calories` | `INT NULL` — 수동 입력, 선택 |

음식명 → 칼로리 자동 계산은 식품 영양 DB 연동이 필요하므로 범위에서 제외한다.

**`journals`** — 하루 1건

| 컬럼 | 타입 |
|---|---|
| `content` | `TEXT` |

`UNIQUE(user_id, occurred_on) WHERE deleted_at IS NULL`

**`books`** — 책 마스터 (`occurred_on` 없음)

| 컬럼 | 타입 |
|---|---|
| `title` | `TEXT NOT NULL` |
| `author` | `TEXT NULL` |
| `summary` | `TEXT NULL` — 책 내용·줄거리 |
| `status` | `TEXT` — `READING`/`DONE`/`WISHLIST` |
| `started_on` | `DATE NULL` |
| `finished_on` | `DATE NULL` |

**`book_notes`** — 감상평 (책당 여러 개)

| 컬럼 | 타입 |
|---|---|
| `book_id` | `BIGINT NOT NULL` |
| `book_client_uuid` | `UUID NOT NULL` — 동기화용 부모 참조 |
| `occurred_on` | `DATE NOT NULL` — 작성한 날 |
| `content` | `TEXT NOT NULL` |

`occurred_on`이 있어 감상평은 오늘 화면과 캘린더에도 나타난다.

페이지 진도율·독서 시간·별점은 범위에서 제외한다.

**`expense_categories`** — 사용자 정의. 가입 시 기본 세트(식비/교통/생활/여가/기타) 자동 생성. `occurred_on` 없음

`name`에는 유니크 제약을 걸지 않는다. 두 기기에서 오프라인으로 같은 이름을 만들면 서로 다른 `client_uuid`로 올라와 제약 위반이 되고, 그 실패는 400(영구 실패)이라 사용자 입력이 버려진다. 중복 이름은 화면에서 다룬다.

**계정 테이블**

- `users` — `login_id`(로그인 식별자), `email`(복구용), `password_hash`, `email_verified_at`, `status`(`ACTIVE` / `SUSPENDED` / `PENDING_DELETION`), `deletion_requested_at`
- `refresh_tokens` — 토큰 해시, 만료, 폐기 여부, 로테이션 체인
- `password_reset_tokens` — 토큰 해시, 만료, 사용 여부
- `login_attempts` — 아이디, IP, 성공 여부, 시각

### 소프트 삭제

`deleted_at`이 있는 테이블은 물리 삭제하지 않는다. 삭제도 다른 기기로 전파되어야 하므로 툼스톤이 남아야 한다.

조회 쿼리에 `deleted_at IS NULL`을 반드시 포함한다. 동기화 pull 쿼리만 예외로 삭제된 행도 내려보낸다.

책을 삭제하면 감상평도 함께 툼스톤 처리한다. DB `ON DELETE CASCADE`는 소프트 삭제에서 동작하지 않으므로 **서비스 계층에서 명시적으로 자식까지 소프트 삭제**하고, 그 변경분도 동기화 대상이 된다.

### 소유권 격리

모든 조회·수정·삭제 쿼리에 `user_id = :userId` 조건을 포함한다. `userId`는 인증 미들웨어가 주입한 값만 사용하며, 요청 본문이나 쿼리스트링의 사용자 ID는 신뢰하지 않는다.

### 인덱스

```sql
CREATE INDEX ON {table} (user_id, occurred_on);   -- 화면 조회
CREATE INDEX ON {table} (user_id, synced_at, id); -- 동기화 pull
CREATE UNIQUE INDEX ON {table} (user_id, client_uuid);
```

### 코드성 데이터

상태·구분·유형처럼 정해진 값 집합에서 고르는 데이터는 **값을 대문자로 관리한다.** 여러 단어는 `SCREAMING_SNAKE_CASE`를 쓴다 (`PENDING_DELETION`, `FULL_BODY`).

- DB는 `TEXT` + `CHECK` 제약, 애플리케이션은 zod enum으로 검증한다. 두 곳 모두에서 막는다
- **컬럼명·테이블명은 그대로 snake_case 소문자다.** 대문자 규칙은 값에만 적용된다
- 화면 표시용 한글 라벨은 코드값과 분리해 프론트에서 매핑한다. DB에 표시 문자열을 넣지 않는다

쿼리나 로그에서 `'EXPENSE'`는 코드값, `'점심 김밥'`은 사용자 입력임이 형태만으로 드러나는 것이 목적이다.

### 금액

금액은 `NUMERIC(12,2)`를 사용한다. `FLOAT`/`DOUBLE`은 금지한다. 애플리케이션에서도 부동소수점 연산을 거치지 않는다.

### 로컬(Dexie) 스키마

서버 테이블과 동일한 모양을 미러링하고, 추가로 두 개를 둔다.

```
outbox: { seq(auto), table, clientUuid, op: 'UPSERT'|'DELETE',
          payload, updatedAt, tryCount, lastError, queuedAt }
meta:   { key, value }   // lastPulledSyncedAt, lastPulledId, userId
```

인덱스는 `[userId+occurredOn]` 중심으로 건다.

---

## 5. 동기화 프로토콜

이 앱에서 버그가 가장 많이 발생할 영역이므로 구체적으로 정의한다.

### 아웃박스 큐

로컬 변경은 Dexie에 즉시 반영되고 동시에 큐에 기록된다.

- **`seq` 순서대로 전송한다.** 책 → 감상평 같은 부모-자식 순서가 이것으로 보장된다
- **compaction 규칙** — 같은 `clientUuid`에 대해:
  - `UPSERT` + `UPSERT` → 마지막 것만 남긴다. 일기처럼 타이핑 중 계속 저장되는 데이터가 큐를 수백 줄로 채우는 것을 막는다
  - `UPSERT` + `DELETE` → `DELETE`만 남긴다
  - **서버에 한 번도 전송된 적 없는 레코드가 삭제되면 큐에서 둘 다 제거한다.** 서버가 모르는 레코드의 툼스톤을 보낼 이유가 없다
  - compaction 시 `seq`는 **가장 오래된 항목의 값을 유지**한다. 그래야 부모-자식 순서가 깨지지 않는다
- 큐 상태를 사용자에게 보여준다. "미동기화 N건" 표시가 없으면 동기화가 조용히 멈춰도 아무도 알아채지 못한다

### 엔드포인트

```
POST /api/sync/push
  { schemaVersion, changes: [{ table, clientUuid, op, updatedAt, payload }] }
→ { results: [{ clientUuid, id, status: 'APPLIED'|'STALE'|'CONFLICT'|'REJECTED' }],
    serverTime }

GET /api/sync/pull?since=<syncedAt>&sinceId=<id>&limit=500
→ { changes: [...], nextCursor: { syncedAt, id }, hasMore }
```

**pull 커서가 `(synced_at, id)` 복합인 이유**: 같은 밀리초에 여러 행이 저장되면 타임스탬프만으로는 경계에서 행이 누락되거나 같은 행을 무한 반복한다.

삭제된 행(툼스톤)도 pull에 포함한다.

### 충돌 해결 — 레코드 단위 last-write-wins

`updated_at`이 더 최신인 쪽이 이긴다.

```sql
INSERT INTO {table} (...) VALUES (...)
ON CONFLICT (user_id, client_uuid) DO UPDATE
   SET ...
 WHERE {table}.updated_at < EXCLUDED.updated_at;
```

진 쪽은 `STALE` 응답을 받고 서버 값으로 로컬을 갱신한다.

필드 단위 병합은 하지 않는다. 본인 기록을 본인만 수정하는 앱이므로 실제 충돌은 기기 2대를 동시에 쓸 때만 발생하고, 그때도 "나중에 고친 것이 남는다"가 사용자 기대와 일치한다.

**일기 예외**: 하루 1건 제약이 있는데 두 기기에서 각각 오늘 일기를 쓰면 서로 다른 `client_uuid`가 생겨 `UNIQUE(user_id, occurred_on)`에 걸린다. 따라서 일기의 `client_uuid`는 랜덤이 아니라 **`uuidv5(userId + occurred_on)`로 결정론적으로 생성**한다. 두 기기가 같은 날 일기를 쓰면 같은 UUID가 나와 자동으로 LWW 병합된다.

### 부모-자식 동기화

오프라인에서 책 등록 → 감상평 작성을 연달아 하면, 감상평 전송 시점에 부모 책의 서버 `id`가 없다.

```
1. 아웃박스는 seq 순서대로 전송 → 책이 감상평보다 먼저 나간다
2. 서버: (user_id, book_client_uuid)로 books 조회 → book_id 확정 → 감상평 저장
3. 부모를 못 찾으면 409 → 클라이언트는 큐에 남기고 다음 주기에 재시도
```

부모 없음은 "영구 실패"가 아니라 "아직 이르다"로 다룬다. 실패로 처리해 큐에서 제거하면 감상평이 영구 소실된다.

지출 → 카테고리도 같은 구조다. `expenses.category_client_uuid`로 `expense_categories`를 조회해 `category_id`를 확정한다. 다만 카테고리는 선택 항목이라 `category_client_uuid`가 NULL이면 미분류로 저장하고, 값이 있는데 부모를 못 찾을 때만 409다.

FK는 부모의 **존재**만 보장한다. 부모가 같은 사용자의 것인지는 검사하지 않으므로, 부모 조회에는 반드시 `user_id` 조건을 함께 건다.

### 재시도

| 유형 | 예 | 처리 |
|---|---|---|
| 일시 실패 | 네트워크 끊김, 5xx, 409(부모 아직 없음) | 큐 유지, 지수 백오프 (1s → 2s → 4s … 최대 5분) |
| 영구 실패 | 400/422 (검증 실패, 스키마 불일치) | 큐에서 제거, 별도 보관 후 **사용자에게 알림** |

영구 실패 항목을 조용히 버리면 사용자는 기록이 사라진 것을 나중에 발견한다. 반대로 영구 실패를 무한 재시도하면 큐가 그 항목에서 영영 막힌다.

### 동기화 트리거

- 앱 시작 시
- `online` 이벤트 (오프라인 → 온라인 복귀)
- 탭 포커스 복귀 시
- 온라인 상태에서 30초 주기
- 큐에 항목 추가 직후 (온라인이면 즉시)

웹소켓·푸시는 사용하지 않는다. 개인 기록 앱이라 실시간성이 필요 없고, 자체 운영 VPS에 상시 연결을 얹을 이유가 없다.

### 초기 동기화

새 기기 로그인 시 `since=0`부터 페이지네이션으로 전량 내려받고, 완료 전까지 "불러오는 중" 상태를 표시한다. 완료 전 화면을 열면 데이터가 부분만 보여 사용자가 기록 유실로 오해한다.

### 스키마 버전

push/pull 페이로드에 `schemaVersion`을 포함한다. 서버가 더 낮은 버전을 받으면 `426 Upgrade Required`로 응답하고 클라이언트는 Service Worker 갱신을 유도한다. PWA는 사용자가 캐시된 구버전을 오래 유지할 수 있어, 이 방어가 없으면 구버전이 잘못된 모양의 데이터를 계속 전송한다.

---

## 6. 인증

### 토큰 구조

| | 저장 위치 | 수명 |
|---|---|---|
| 액세스 토큰 (JWT) | 메모리만 | 15분 |
| 리프레시 토큰 | httpOnly + Secure + SameSite=Strict 쿠키 | 30일 |

nginx가 같은 도메인에서 `/`와 `/api`를 서빙하므로 쿠키를 사용할 수 있다. 리프레시 토큰을 `localStorage`에 두지 않는 이유는 XSS가 한 번 뚫리면 30일짜리 토큰이 그대로 유출되기 때문이다.

이 구조는 오프라인과 잘 맞는다. 앱을 재시작하면 액세스 토큰은 사라지지만, 화면은 Dexie만 읽으므로 **토큰 없이도 앱이 정상 동작한다.** 온라인 복귀 후 동기화가 필요한 시점에 `/auth/refresh`로 조용히 재발급받는다.

리프레시 토큰은 사용할 때마다 교체(rotation)하고, 이미 사용된 토큰이 다시 들어오면 탈취로 간주해 해당 사용자의 모든 세션을 무효화한다.

### 비밀번호

- **argon2id** 해싱
- 최소 10자. 복잡도 강제는 하지 않는다 — 특수문자 강제는 예측 가능한 패턴만 양산한다(NIST 권고). 대신 흔한 비밀번호 블랙리스트로 거른다
- 최대 128자로 제한한다. 제한이 없으면 수 MB짜리 입력으로 해싱 비용 공격이 가능하다

### 로그인 실패 대응

**계정 잠금은 사용하지 않는다.** 공격자가 남의 아이디로 일부러 실패시켜 계정을 잠글 수 있어, 방어가 아니라 서비스 거부 수단이 된다.

대신 IP 기준 rate limit + 계정 기준 지수 지연(1s → 2s → 4s …)을 적용하고, 모든 시도를 `login_attempts`에 기록한다.

### 이메일

비밀번호 재설정 때문에 메일 발송이 필요하다.

**VPS에 직접 메일 서버를 띄우지 않는다.** SPF/DKIM/DMARC를 맞춰도 신규 IP는 스팸함으로 분류되어 사용자가 가입 실패로 인식한다. Resend 또는 AWS SES를 사용한다. 인프라 자체 운영 방침의 의도적 예외다.

**이메일 인증은 비차단 방식**이다. 가입 즉시 앱을 사용할 수 있고 인증 메일은 백그라운드로 발송된다. 비밀번호 재설정 요청 시에만 인증된 이메일을 요구한다. 검증 단계에서 인증 링크 클릭을 가입 관문으로 두면 유입의 상당수를 잃는다.

### 비밀번호 재설정

- 1회용 토큰, 30분 만료, 사용 즉시 폐기
- 토큰은 DB에 해시로 저장한다 (DB 유출 시에도 재설정 불가)
- **이메일 존재 여부를 응답으로 구분하지 않는다.** 항상 동일한 응답을 반환한다. 구분하면 가입자 이메일 목록을 만들 수 있다

> **아이디 열거는 구조적으로 허용된다.** 가입 화면이 "이미 사용 중인 아이디입니다"를 알려주지 않으면 가입 자체가 불가능하기 때문이다. 로그인 응답은 계속 계정 존재 여부를 구분하지 않는다 — 그 경로는 비밀번호까지 맞혀야 하므로 방어할 가치가 남아 있다.
- 재설정 성공 시 기존 리프레시 토큰 전량 폐기

### 로그아웃과 로컬 데이터

로그아웃 시 로컬 Dexie를 비운다. 공용 기기에서 다음 사용자가 남의 일기와 지출 내역을 볼 수 없어야 한다.

**단, 미동기화 큐가 남아 있으면 그대로 지우지 않는다.**

```
로그아웃 시도
 ├ 큐 비어 있음 → 즉시 로그아웃 + 로컬 삭제
 └ 큐에 N건 남음
    ├ 온라인  → 전송 시도 후 로그아웃
    └ 오프라인 → "동기화되지 않은 기록 N건이 있습니다. 지금 로그아웃하면
                  이 기록은 사라집니다." 경고 후 사용자 확인
```

401을 받았다고 로컬 DB를 비우는 구현은 하지 않는다. 오프라인에서 여러 날 기록한 사용자의 데이터를 한 번에 잃는 가장 흔한 경로다.

### 회원 탈퇴

소프트 삭제 규칙과 별개로 계정 파기는 실제 삭제까지 이어진다. 30일 유예 기간(오조작 복구용) 후 배치로 해당 사용자의 모든 행을 물리 삭제한다.

### 엔드포인트

```
POST   /api/auth/register        아이디, 이메일, 비밀번호
POST   /api/auth/login           아이디, 비밀번호 → 액세스 토큰 + 리프레시 쿠키
POST   /api/auth/refresh         쿠키로 재발급 (로테이션)
POST   /api/auth/logout          현재 리프레시 토큰 폐기
POST   /api/auth/password/forgot 재설정 메일 요청
POST   /api/auth/password/reset  토큰 + 새 비밀번호
POST   /api/auth/verify-email    인증 링크 처리
DELETE /api/account              탈퇴 (30일 유예 시작)
```

---

## 7. 에러 처리

### API 응답 형식

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "사용자에게 보여줄 문구", "details": [] } }
```

- `code`는 클라이언트 분기용 안정된 문자열이다. `message`는 변경될 수 있지만 `code`는 계약이다
- Fastify 전역 에러 핸들러 한 곳에서 변환한다. 라우트마다 try/catch를 흩뿌리지 않는다
- 스택 트레이스·SQL 원문은 응답에 포함하지 않는다. 로그에만 남기고 응답에는 `requestId`만 실어 문의와 로그를 연결한다

### 클라이언트 원칙

**오프라인은 에러가 아니다.** 네트워크 실패로 토스트를 띄우면 이동 중 내내 경고가 뜬다. 조용히 큐에 남기고 "미동기화 N건" 표시만 유지한다.

사용자에게 실제로 알려야 하는 것은 세 가지다.

1. 영구 실패한 항목이 발생했을 때
2. 저장 공간 부족 (`QuotaExceededError`)
3. IndexedDB를 사용할 수 없을 때 (Safari 프라이빗 모드 등) — "이 브라우저에서는 기록을 저장할 수 없습니다"를 명확히 알린다. 조용히 실패하면 사용자는 저장된 줄 알고 계속 기록한다

### 로그

비밀번호·토큰·세션 값·이메일 전문을 남기지 않는다. 일기 본문·지출 내역 등 기록 데이터도 로그로 출력하지 않으며, 디버깅이 필요하면 레코드 ID만 남긴다.

---

## 8. 테스트 전략

커버리지 숫자를 목표로 잡지 않는다. 위험한 곳에 집중한다.

| 계층 | 도구 | 대상 |
|---|---|---|
| 단위 | Vitest | 충돌 해결, 큐 compaction, 통계 집계, 날짜 유틸 |
| 통합 | Vitest + `fastify.inject()` + 실제 테스트 DB | 라우트, 동기화 업서트, 소유권 격리 |
| E2E | Playwright | 오프라인 시나리오 |

### 필수 동기화 시나리오

여기서 발생하는 버그는 데이터 유실이다.

- 오프라인 생성 → 온라인 복귀 → 서버 반영
- 같은 변경 2회 전송 → 중복 행 없음 (멱등)
- 책 → 감상평 순서 보장, 부모 없음(409) 후 재시도 성공
- 두 기기 동시 수정 → 나중 `updated_at`이 승리
- 삭제 → 다른 기기로 툼스톤 전파
- 로그아웃 시 미동기화 큐 경고
- 다른 사용자의 `id`로 요청 → 거부 (소유권 격리)
- 일기 결정론적 UUID → 두 기기 동시 작성 시 UNIQUE 위반 없이 병합

E2E는 Playwright의 `context.setOffline(true)`로 실제 오프라인을 재현한다. 목으로 흉내 낼 수 없는 영역이다.

**동기화 엔진은 TDD로 작성한다.** 상태 조합이 많아 나중에 테스트를 붙이려 하면 이미 검증 불가능한 구조가 되어 있다.

---

## 9. 구현 순서 권고

기능이 다섯 개(지출·운동·식사·일기·독서)라 검증 단계 MVP로는 적지 않다.

1. **기반** — 모노레포 구성, DB 스키마, 인증, 배포 파이프라인
2. **동기화 엔진 + 지출** — 가장 단순한 도메인으로 동기화를 완성하고 검증한다
3. **일기** — 결정론적 UUID와 하루 1건 제약을 검증한다
4. **식사, 운동** — 같은 패턴 반복. 운동은 JSONB 세트 입력 UI가 추가 작업
5. **독서** — 부모-자식 동기화가 필요한 유일한 기능이므로 마지막
6. **통계 화면**
7. **공개 준비** — 약관, 개인정보처리방침, 탈퇴 파기 배치

동기화 엔진이 2~3단계에서 검증되면 이후는 같은 패턴의 반복이라 속도가 붙는다.

---

## 10. 범위에서 제외한 것

| 항목 | 사유 |
|---|---|
| 음식명 → 칼로리 자동 계산 | 식품 영양 DB 연동이 별도 프로젝트 규모 |
| 독서 진도율·페이지 추적 | 요청 범위에 없음 |
| 소셜 로그인 | ID/PW 자체 구현으로 결정 |
| 푸시 알림 | 웹 PWA에서 iOS 제약이 크고, 검증 단계에 불필요 |
| 운동 종목 마스터 테이블 | 자유 입력 + 최근 사용 자동완성으로 충분 |
| 운동·식사 카테고리 사용자 정의 | 분류 니즈가 확인되지 않음 |
| 데이터 내보내기 | 공개 후 요구가 나오면 추가 |

---

## 11. 미결정 항목

공개 배포 전에 확정해야 한다.

| 항목 | 내용 |
|---|---|
| 이용약관·개인정보처리방침 | 운동·식사 기록은 건강 관련 정보로 해석될 여지가 있다. 문안 작성 필요 |
| 도메인·호스팅 | VPS 사양, 도메인 등록 |
| 메일 발송 서비스 선택 | Resend vs AWS SES |
| 디자인 시스템 | 색상·타이포·컴포넌트 톤 |
