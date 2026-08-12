# 공통코드 테이블과 독서 장르 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드 그룹과 코드를 관리하는 공통코드 테이블을 만들고, 그 위에 책의 장르 구분을 올린다.

**Architecture:** `code_groups`·`codes`는 도메인 테이블이 아니다 — `user_id`가 없고 동기화 파이프를 타지 않는다. 클라이언트는 전용 `GET /api/codes`로 받아 Dexie에 캐시한다. `books.genre`는 코드값을 담는 `TEXT`이며, FK도 CHECK도 걸지 않고 서버가 sync 페이로드 검증 단계에서 `codes`와 대조한다.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL 18(api), Fastify, zod(shared), React 19 + Dexie(web), vitest.

설계 문서: [2026-08-12-common-code-book-genre-design.md](../specs/2026-08-12-common-code-book-genre-design.md)

## Global Constraints

- 코드성 값은 대문자다. `group_code`·`code` 모두 `SCREAMING_SNAKE_CASE`. **컬럼명·테이블명은 그대로 snake_case 소문자다.**
- `_at` 컬럼을 만들면 짝이 되는 `_by`를 반드시 함께 만든다. 행위자가 없으면 시스템 sentinel `0`.
- 시각 컬럼은 `TIMESTAMP`(타임존 없음)로 KST 로컬 시각을 저장한다. `TIMESTAMPTZ`를 쓰지 않는다.
- 물리 삭제 금지. 삭제는 `deleted_at` 소프트 삭제다.
- **모든 컬럼에 DB 코멘트를 단다.** 테이블 정의 바로 아래 `columnComments(테이블, { … })`, 새 테이블은 `ALL_COLUMN_COMMENTS`에도 추가. 빠뜨리면 `column-comments.test.ts`가 잡는다.
- 인증이 필요한 라우트는 `{ preHandler: requireAuth }`를 붙인다. 요청 본문·쿼리스트링의 사용자 ID는 신뢰하지 않는다.
- 사용자 기록 데이터(책 제목, 감상평 본문)를 로그로 출력하지 않는다.
- 주석은 한국어. 이 저장소의 주석은 "무엇을"이 아니라 "왜, 안 하면 무슨 일이 나는지"를 적는다.
- 커밋 메시지는 한국어. 마지막 줄: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- 작업 브랜치는 `feat/common-code-book-genre`다. 이미 체크아웃되어 있다.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `packages/shared/src/common-code.ts` | `CODE_GROUP` 상수와 `/codes` 응답 타입 |
| `packages/shared/src/common-code.test.ts` | 위의 테스트 |
| `apps/api/src/routes/codes.ts` | `GET /codes` 라우트 |
| `apps/api/src/routes/codes.test.ts` | 위의 테스트 |
| `apps/web/src/codes/repository.ts` | 코드 캐시의 Dexie 읽기/쓰기 |
| `apps/web/src/codes/refresh.ts` | `/codes` 호출 → 캐시 교체 |
| `apps/web/src/codes/label.ts` | 코드값 → 라벨. 캐시에 없으면 코드값 그대로 |
| `apps/web/src/codes/codes.test.ts` | 위 셋의 테스트 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `apps/api/src/db/schema.ts` | `codeGroups`·`codes` 테이블, `books.genre`, 코멘트, `ALL_COLUMN_COMMENTS` |
| `apps/api/drizzle/` | 마이그레이션 2건 (생성 + 시드 SQL 수기 추가) |
| `apps/api/src/app.ts` | `codesRoutes` 등록 |
| `apps/api/src/sync/registry.ts` | `SyncTableDef.validate` 훅, `books`의 장르 검증 |
| `apps/api/src/sync/push.ts` | `validate` 호출 지점 |
| `apps/api/src/routes/sync.test.ts` | 장르 케이스 |
| `packages/shared/src/index.ts` | `common-code.ts` 재export |
| `packages/shared/src/sync.ts` | `bookPayloadSchema.genre`, `SCHEMA_VERSION` 3 |
| `packages/shared/src/sync.test.ts` | genre 케이스 |
| `apps/web/src/db/index.ts` | version(4) `codes` 스토어, `LocalCode` |
| `apps/web/src/App.tsx` | 인증 후 `refreshCodes()` |
| `apps/web/src/pages/book/repository.ts` | `BookInput.genre` |
| `apps/web/src/pages/book/BookForm.tsx` | 장르 `<select>` |
| `apps/web/src/pages/book/BookListPage.tsx` | 코드 조회 + 라벨 표시 |
| `apps/web/src/pages/book/BookDetailPage.tsx` | 라벨 표시 |
| `apps/web/src/sync/apply.ts` | `books` applier에 `genre` |
| `.claude/roles/database.md` | 공통코드 예외 규칙 |

---

## Task 1: 공통코드 테이블

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/<생성된 이름>.sql` (drizzle-kit이 만들고, 시드 SQL을 손으로 덧붙인다)
- Test: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Consumes: 같은 파일의 `auditColumns`, `AUDIT_COMMENTS`, `columnComments`
- Produces: `codeGroups`, `codes` drizzle 테이블. `codes`의 컬럼 속성명은 `id`, `groupCode`, `code`, `name`, `sortOrder` + 감사 컬럼

**이 테이블은 도메인 테이블이 아니다.** `syncColumns`(`client_uuid`·`user_id`·`synced_at`)를 스프레드하지 마라. 사용자 데이터가 아니고 동기화 파이프를 타지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/db/schema.test.ts` 끝에 추가한다. 기존 파일의 import 스타일을 따른다.

```ts
describe('공통코드 테이블', () => {
  it('code_groups는 동기화 컬럼을 갖지 않는다', () => {
    const columns = Object.keys(getTableColumns(codeGroups))
    // 사용자 데이터가 아니다. user_id를 두면 전역 코드가 사용자별로 갈라진다.
    expect(columns).not.toContain('userId')
    expect(columns).not.toContain('clientUuid')
    expect(columns).not.toContain('syncedAt')
  })

  it('codes는 동기화 컬럼을 갖지 않는다', () => {
    const columns = Object.keys(getTableColumns(codes))
    expect(columns).not.toContain('userId')
    expect(columns).not.toContain('clientUuid')
    expect(columns).not.toContain('syncedAt')
  })

  it('code_groups는 감사 컬럼을 갖는다', () => {
    const columns = Object.keys(getTableColumns(codeGroups))
    for (const name of [
      'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy',
    ]) {
      expect(columns).toContain(name)
    }
  })

  it('codes는 그룹·코드·라벨·정렬을 갖는다', () => {
    const columns = Object.keys(getTableColumns(codes))
    for (const name of ['groupCode', 'code', 'name', 'sortOrder']) {
      expect(columns).toContain(name)
    }
  })
})
```

파일 맨 위 import에 `getTableColumns`(`drizzle-orm`)와 `codeGroups`, `codes`(`./schema.ts`)가 필요하다. 이미 있으면 그대로 쓴다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter api test -- schema.test.ts`
Expected: FAIL — `codeGroups`를 `./schema.ts`에서 찾을 수 없다.

- [ ] **Step 3: 테이블을 정의한다**

`apps/api/src/db/schema.ts`의 독서 섹션 **앞**, 도메인 테이블들보다 위에 새 섹션을 넣는다. 공통코드는 도메인이 아니라 기반 데이터이므로 위쪽이 읽기 순서에 맞다.

```ts
// ---------------------------------------------------------------------------
// 공통코드
// ---------------------------------------------------------------------------

/**
 * 코드 그룹.
 *
 * 도메인 테이블이 아니다 — `user_id`·`client_uuid`·`synced_at`이 없다. 사용자가
 * 만드는 데이터가 아니라 운영 데이터이고, 동기화 push/pull을 타지 않는다.
 * 클라이언트에는 전용 `GET /codes`로 내려간다.
 */
export const codeGroups = pgTable('code_groups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  groupCode: text('group_code').notNull(),
  name: text('name').notNull(),
  ...auditColumns,
}, (t) => [
  uniqueIndex('code_groups_group_code_uq').on(t.groupCode),
])

export const codeGroupsComments = columnComments(codeGroups, {
  id: '코드 그룹 내부 식별자',
  groupCode: '그룹 코드. 대문자 SCREAMING_SNAKE_CASE (예: BOOK_GENRE)',
  name: '그룹의 관리용 한글 이름',
  ...AUDIT_COMMENTS,
})

/**
 * 코드.
 *
 * `name`이 **화면에 그대로 뜨는 한글 라벨이다.** 다른 코드성 데이터는 라벨을
 * 프론트 상수로 두지만(`STATUS_LABEL`), 공통코드는 배포 없이 코드를 늘리는 것이
 * 목적이라 라벨도 DB가 갖는다.
 */
export const codes = pgTable('codes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  groupCode: text('group_code').notNull()
    .references((): AnyPgColumn => codeGroups.groupCode),
  code: text('code').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  ...auditColumns,
}, (t) => [
  uniqueIndex('codes_group_code_uq').on(t.groupCode, t.code),
  index('codes_group_sort_idx').on(t.groupCode, t.sortOrder),
])

export const codesComments = columnComments(codes, {
  id: '코드 내부 식별자',
  groupCode: '소속 그룹 코드. code_groups.group_code를 참조한다',
  code: '코드값. 대문자 SCREAMING_SNAKE_CASE (예: NOVEL)',
  name: '화면에 표시되는 한글 라벨. 이 값이 그대로 사용자에게 보인다',
  sortOrder: '선택 목록 정렬 순서. 작을수록 앞',
  ...AUDIT_COMMENTS,
})
```

`ALL_COLUMN_COMMENTS` 배열 맨 앞에 두 항목을 더한다.

```ts
export const ALL_COLUMN_COMMENTS: readonly string[] = [
  ...codeGroupsComments,
  ...codesComments,
  ...usersComments,
  // …나머지 그대로
]
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter api test -- schema.test.ts column-comments.test.ts`
Expected: PASS

- [ ] **Step 5: 마이그레이션을 생성한다**

Run: `pnpm --filter api db:generate`

`apps/api/drizzle/`에 새 `.sql` 파일이 생기고 `meta/_journal.json`에 항목이 추가된다. **`_journal.json`을 손으로 편집하지 마라** — drizzle-kit이 관리한다.

- [ ] **Step 6: 생성된 마이그레이션 끝에 시드 SQL을 덧붙인다**

Step 5가 만든 `.sql` 파일 맨 아래에 추가한다. `--> statement-breakpoint`는 drizzle의 문장 구분자이므로 각 문장 사이에 넣는다.

```sql
--> statement-breakpoint
INSERT INTO "code_groups"
  ("group_code", "name", "created_at", "created_by", "updated_at", "updated_by")
VALUES ('BOOK_GENRE', '독서 장르', NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "codes"
  ("group_code", "code", "name", "sort_order",
   "created_at", "created_by", "updated_at", "updated_by")
VALUES
  ('BOOK_GENRE', 'NOVEL',      '소설',   1, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ESSAY',      '에세이', 2, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'HUMANITIES', '인문',   3, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'SCIENCE',    '과학',   4, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'TECH',       '기술',   5, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ECONOMY',    '경제',   6, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ETC',        '기타',   7, NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code", "code") DO NOTHING;
```

`ON CONFLICT DO NOTHING`이 멱등을 보장한다. `created_by`/`updated_by`의 `0`은 시스템 sentinel이다 — 이 행을 만든 행위자가 사람이 아니다.

`uniqueIndex`가 만든 것은 인덱스이지 제약이 아니므로, `ON CONFLICT (컬럼목록)` 형태를 쓴다(제약 이름이 아니라). PostgreSQL은 유니크 인덱스를 conflict target으로 받는다.

- [ ] **Step 7: 마이그레이션과 코멘트를 반영한다**

```bash
pnpm --filter api db:migrate
pnpm --filter api db:comments
```

Expected: 둘 다 성공. `db:comments`는 반영 건수를 출력한다.

- [ ] **Step 8: 시드가 들어갔는지 DB로 확인한다**

**새 파일 `apps/api/src/db/code-seed.db.test.ts`에 만든다.** 기존 DB 테스트 파일에 넣으면 안 된다 — 그쪽 `beforeEach`의 `resetDb()`가 `TRUNCATE ... CASCADE`로 모든 테이블을 비우고, 마이그레이션이 넣은 시드는 복구되지 않는다. 이 파일에서는 **`resetDb()`를 부르지 않는다.**

```ts
describe('공통코드 시드', () => {
  it('BOOK_GENRE 그룹과 코드가 들어 있다', async () => {
    const [group] = await db.select().from(codeGroups)
      .where(eq(codeGroups.groupCode, 'BOOK_GENRE'))
    expect(group?.name).toBe('독서 장르')

    const rows = await db.select().from(codes)
      .where(eq(codes.groupCode, 'BOOK_GENRE'))
      .orderBy(codes.sortOrder)
    expect(rows.map((r) => r.code)).toEqual([
      'NOVEL', 'ESSAY', 'HUMANITIES', 'SCIENCE', 'TECH', 'ECONOMY', 'ETC',
    ])
    expect(rows[0]?.name).toBe('소설')
  })
})
```

파일 전체는 이렇게 시작한다.

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { codeGroups, codes } from './schema.ts'

afterAll(async () => { await pool.end() })
```

이 테스트는 **마이그레이션이 넣은 시드가 실제로 DB에 있는지**를 본다. 다른 테스트가 `resetDb()`로 테이블을 비우면 이 파일도 함께 깨진다 — vitest가 파일을 병렬로 돌리면 그럴 수 있다. 깨지면 `pnpm --filter api test -- code-seed` 단독으로 다시 돌려 보고, 단독으로는 통과하는데 전체에서만 깨진다면 그 사실을 보고하라. 시드 검증을 통합 스위트에서 신뢰할 수 없다는 뜻이고, 그건 계획이 판단할 문제다.

- [ ] **Step 9: 확인하고 커밋한다**

Run: `pnpm --filter api test`
Expected: PASS

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/schema.test.ts \
        apps/api/drizzle/
git add apps/api/src/db/*.test.ts
git commit -m "feat(api): 공통코드 테이블과 독서 장르 시드

code_groups/codes는 도메인 테이블이 아니다. user_id·client_uuid·
synced_at을 두지 않는다 — 사용자가 만드는 데이터가 아니라 운영
데이터이고, 동기화 push/pull을 타지 않는다.

codes.name이 화면에 그대로 뜨는 라벨이다. 배포 없이 코드를 늘리는
것이 목적이라 라벨도 DB가 갖는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `books.genre` 컬럼

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/<생성된 이름>.sql`
- Test: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Consumes: Task 1의 `codes` 테이블(참조는 하지 않는다 — 아래 참고)
- Produces: `books.genre` 컬럼 (속성명 `genre`, DB 컬럼 `genre`)

**FK도 CHECK도 걸지 않는다.** 이유는 Step 3의 주석에 그대로 적는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/db/schema.test.ts`의 공통코드 describe 아래에 추가한다.

```ts
describe('books.genre', () => {
  it('장르 컬럼을 갖는다', () => {
    expect(Object.keys(getTableColumns(books))).toContain('genre')
  })

  it('장르는 NULL을 허용한다 — 미지정이 정상이다', () => {
    expect(getTableColumns(books).genre.notNull).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter api test -- schema.test.ts`
Expected: FAIL — `genre`가 컬럼 목록에 없다.

- [ ] **Step 3: 컬럼을 더한다**

`apps/api/src/db/schema.ts`의 `books` 정의에서 `finishedOn` 아래에 넣는다.

```ts
  finishedOn: date('finished_on', { mode: 'string' }),
  /**
   * 장르 코드값. codes 테이블의 BOOK_GENRE 그룹에 속한다.
   *
   * **FK도 CHECK도 걸지 않는다.** 오프라인 기기가 관리자가 방금 지운 코드로
   * 책을 만들어 push하면 FK 위반이 DB 에러가 되고, 그 500은 REJECTED가 아니라
   * 재시도 대상이라 그 항목이 큐에서 영원히 빠지지 않는다. 대신 서버가 sync
   * 페이로드 검증 단계에서 codes와 대조해 REJECTED로 돌려준다.
   */
  genre: text('genre'),
```

`booksComments`에도 항목을 더한다. 빠뜨리면 컴파일이 깨진다.

```ts
  finishedOn: '다 읽은 날. started_on보다 앞설 수 없다',
  genre: '장르 코드값 (codes의 BOOK_GENRE 그룹). FK를 걸지 않고 서버가 대조 검증한다',
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter api test -- schema.test.ts column-comments.test.ts`
Expected: PASS

- [ ] **Step 5: 마이그레이션을 생성하고 반영한다**

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
pnpm --filter api db:comments
```

생성된 SQL은 `ALTER TABLE "books" ADD COLUMN "genre" text;` 한 줄이어야 한다. 다른 변경이 섞여 있으면 멈추고 보고하라 — Task 1의 마이그레이션이 제대로 반영되지 않았다는 뜻이다.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/schema.test.ts apps/api/drizzle/
git commit -m "feat(api): books에 장르 코드 컬럼

FK도 CHECK도 걸지 않는다. 오프라인 기기가 삭제된 코드로 push하면 FK
위반이 500이 되고, 500은 재시도 대상이라 큐가 영원히 막힌다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: shared — 공통코드 타입과 장르 필드

**Files:**
- Create: `packages/shared/src/common-code.ts`
- Create: `packages/shared/src/common-code.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/codes.ts`
- Modify: `packages/shared/src/sync.ts`
- Modify: `packages/shared/src/sync.test.ts`

**Interfaces:**
- Produces:
  - `CODE_GROUP = { BOOK_GENRE: 'BOOK_GENRE' } as const`, `type CodeGroup = (typeof CODE_GROUP)[keyof typeof CODE_GROUP]`
  - `interface CodeItem { code: string; name: string; sortOrder: number }`
  - `interface CodeGroupPayload { groupCode: string; name: string; codes: CodeItem[] }`
  - `interface CodesResponse { groups: CodeGroupPayload[] }`
  - `bookPayloadSchema`에 `genre: string | null` (기본값 `null`)
  - `SCHEMA_VERSION = 3`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/common-code.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { CODE_GROUP } from './common-code.ts'

describe('공통코드 그룹', () => {
  it('그룹 코드는 대문자와 밑줄만 쓴다', () => {
    for (const group of Object.values(CODE_GROUP)) {
      expect(group).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('독서 장르 그룹을 갖는다', () => {
    expect(CODE_GROUP.BOOK_GENRE).toBe('BOOK_GENRE')
  })
})
```

`packages/shared/src/sync.test.ts`의 `describe('bookPayloadSchema', …)` 안에 추가한다.

```ts
  it('장르를 생략하면 null로 채운다', () => {
    expect(bookPayloadSchema.parse(book()).genre).toBeNull()
  })

  it('장르 코드값을 그대로 받는다', () => {
    expect(bookPayloadSchema.parse(book({ genre: 'NOVEL' })).genre).toBe('NOVEL')
  })

  // 값 집합이 DB에 있으므로 여기서 enum으로 막을 수 없다. 서버가 codes와
  // 대조해 REJECTED로 돌려준다.
  it('모르는 코드값도 스키마 단계에서는 통과한다', () => {
    expect(bookPayloadSchema.safeParse(book({ genre: 'WHATEVER' })).success).toBe(true)
  })

  it('빈 문자열 장르는 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ genre: '' })).success).toBe(false)
  })
```

같은 파일에 `SCHEMA_VERSION` 테스트를 더한다. import에 `SCHEMA_VERSION`을 추가한다.

```ts
describe('SCHEMA_VERSION', () => {
  // books 페이로드에 genre가 추가됐다. 올리지 않으면 구버전 클라이언트가 책을
  // 수정할 때 genre 없는 페이로드를 보내고, 서버가 null로 덮어 다른 기기에서
  // 설정한 장르가 조용히 지워진다. LWW라 그 값이 최신이 된다.
  it('레코드 모양이 바뀌었으므로 3이다', () => {
    expect(SCHEMA_VERSION).toBe(3)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @daily/shared test`
Expected: FAIL — `./common-code.ts`가 없고, `genre`가 파싱 결과에 없고, `SCHEMA_VERSION`이 2다.

- [ ] **Step 3: `common-code.ts`를 만든다**

```ts
/**
 * 공통코드 그룹 코드.
 *
 * **값 집합은 이 파일이 갖지 않는다.** 그룹 안의 코드 목록은 DB의 `codes`
 * 테이블에 있고, 클라이언트는 `GET /codes`로 받아 캐시한다. 배포 없이 코드를
 * 늘리는 것이 이 구조의 목적이므로, 코드값을 여기 박으면 그 목적이 사라진다.
 *
 * 여기 있는 것은 "어떤 그룹이 존재하는가"뿐이다 — 그건 코드가 참조하는
 * 이름이라 컴파일 시점에 고정되어야 한다.
 */
export const CODE_GROUP = {
  BOOK_GENRE: 'BOOK_GENRE',
} as const
export type CodeGroup = (typeof CODE_GROUP)[keyof typeof CODE_GROUP]

/** `GET /codes` 응답의 코드 한 건. */
export interface CodeItem {
  code: string
  name: string
  sortOrder: number
}

/** `GET /codes` 응답의 그룹 한 건. `codes`는 `sortOrder` 순으로 정렬되어 온다. */
export interface CodeGroupPayload {
  groupCode: string
  name: string
  codes: CodeItem[]
}

export interface CodesResponse {
  groups: CodeGroupPayload[]
}
```

- [ ] **Step 4: `codes.ts`의 `ALL_CODES`에 그룹 코드를 더한다**

`packages/shared/src/codes.ts` 맨 아래를 고친다. 그룹 코드도 코드값 규칙(대문자·밑줄)을 지켜야 하므로 같은 검증을 받게 한다.

```ts
import { CODE_GROUP } from './common-code.ts'

/** 코드값 규칙 검증용 — 새 코드 그룹을 추가하면 여기에도 넣는다. */
export const ALL_CODES: readonly string[] = [
  ...EXPENSE_KIND, ...WORKOUT_KIND, ...BODY_PART, ...INTENSITY,
  ...MEAL_SLOT, ...PORTION, ...BOOK_STATUS, ...USER_STATUS,
  ...OUTBOX_OP, ...SYNC_RESULT,
  ...Object.values(CODE_GROUP),
]
```

import는 파일 맨 위에 둔다.

- [ ] **Step 5: `index.ts`에 재export를 더한다**

```ts
export * from './auth.ts'
export * from './codes.ts'
export * from './common-code.ts'
export * from './datetime.ts'
export * from './sync.ts'
export * from './sync-time.ts'
export * from './workout.ts'
```

- [ ] **Step 6: `sync.ts`에 `genre`와 버전을 반영한다**

`SCHEMA_VERSION`을 3으로 올리고, 주석의 마지막 문단을 이렇게 고친다.

```ts
export const SCHEMA_VERSION = 3
```

`bookPayloadSchema`의 `finishedOn` 아래에 필드를 더한다.

```ts
  finishedOn: occurredOnSchema.nullable().default(null),
  /**
   * 장르 코드값 (`codes`의 `BOOK_GENRE` 그룹).
   *
   * 값 집합이 DB에 있으므로 `z.enum`으로 막을 수 없다. 형식만 보고, 실제
   * 코드인지는 서버가 `codes`와 대조해 판정한다 — 모르면 REJECTED다.
   */
  genre: z.string().min(1).nullable().default(null),
```

`.refine()`은 그대로 둔다. `genre`는 기간 규칙과 무관하다.

- [ ] **Step 7: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @daily/shared test`
Expected: PASS

- [ ] **Step 8: 커밋**

`pnpm build`는 아직 깨진다 — `SCHEMA_VERSION`은 숫자라 컴파일에는 영향이 없지만, api·web이 아직 `genre`를 모른다. `BookPayload` 타입에 필드가 늘어난 것은 **추가**라 기존 소비처가 깨지지 않는다. 확인하고 커밋한다.

Run: `pnpm build`
Expected: 성공. 실패하면 어디가 깨졌는지 보고하고 멈춰라 — 이 태스크는 타입을 넓히기만 하므로 깨질 이유가 없다.

```bash
git add packages/shared/src/
git commit -m "feat(shared): 공통코드 타입과 책 장르 필드

값 집합은 DB의 codes 테이블이 갖는다. CODE_GROUP은 '어떤 그룹이
존재하는가'만 담는다 — 코드값을 여기 박으면 배포 없이 코드를 늘린다는
목적이 사라진다.

SCHEMA_VERSION을 3으로 올린다. 올리지 않으면 구버전 클라이언트가 책을
수정할 때 genre 없는 페이로드를 보내고, 서버가 null로 덮어 다른
기기에서 설정한 장르가 조용히 지워진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `GET /api/codes`

**Files:**
- Create: `apps/api/src/routes/codes.ts`
- Create: `apps/api/src/routes/codes.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 1의 `codeGroups`·`codes` 테이블, Task 3의 `CodesResponse`·`CodeGroupPayload`·`CodeItem`
- Produces: `codesRoutes(app: FastifyInstance): Promise<void>`, `GET /api/codes`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/routes/codes.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { CodesResponse } from '@daily/shared'
import { buildApp } from '../app.ts'
import { db, pool } from '../db/pool.ts'
import { codeGroups, codes, users } from '../db/schema.ts'
import { dbNow } from '../db/time.ts'
import { testLoginId } from '../db/testing.ts'
import { issueAccessToken } from '../auth/tokens.ts'

let app: FastifyInstance

/**
 * `resetDb()`를 부르지 않는다. 공통코드는 마이그레이션 시드가 넣은 운영
 * 데이터라, TRUNCATE로 비우면 이 테스트가 검증할 대상 자체가 사라진다.
 * 대신 이 파일이 만든 행만 개별적으로 지운다.
 */
const TEST_GROUP = 'TEST_ONLY_GROUP'

async function makeUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    loginId: testLoginId(email), email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

async function tokenFor(userId: number) {
  return `Bearer ${await issueAccessToken(userId)}`
}

async function get(auth?: string) {
  const res = await app.inject({
    method: 'GET', url: '/api/codes',
    headers: auth ? { authorization: auth } : {},
  })
  return { res, body: res.json() as CodesResponse }
}

beforeEach(async () => {
  await db.delete(codes).where(eq(codes.groupCode, TEST_GROUP))
  await db.delete(codeGroups).where(eq(codeGroups.groupCode, TEST_GROUP))
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await db.delete(codes).where(eq(codes.groupCode, TEST_GROUP))
  await db.delete(codeGroups).where(eq(codeGroups.groupCode, TEST_GROUP))
  await pool.end()
})

describe('GET /api/codes', () => {
  it('인증 없이는 401을 반환한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/codes' })
    expect(res.statusCode).toBe(401)
  })

  it('시드된 장르 그룹을 sort_order 순으로 내려보낸다', async () => {
    const auth = await tokenFor(await makeUser('acodes@example.com'))
    const { res, body } = await get(auth)

    expect(res.statusCode).toBe(200)
    const genre = body.groups.find((g) => g.groupCode === 'BOOK_GENRE')
    expect(genre?.name).toBe('독서 장르')
    expect(genre?.codes.map((c) => c.code)).toEqual([
      'NOVEL', 'ESSAY', 'HUMANITIES', 'SCIENCE', 'TECH', 'ECONOMY', 'ETC',
    ])
    expect(genre?.codes[0]).toEqual({ code: 'NOVEL', name: '소설', sortOrder: 1 })
  })

  it('삭제된 코드는 내려보내지 않는다', async () => {
    const now = dbNow()
    await db.insert(codeGroups).values({
      groupCode: TEST_GROUP, name: '테스트 그룹',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
    })
    await db.insert(codes).values([
      {
        groupCode: TEST_GROUP, code: 'ALIVE', name: '살아있음', sortOrder: 1,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      },
      {
        groupCode: TEST_GROUP, code: 'GONE', name: '지워짐', sortOrder: 2,
        createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
        deletedAt: now, deletedBy: 0,
      },
    ])

    const auth = await tokenFor(await makeUser('bcodes@example.com'))
    const { body } = await get(auth)

    const group = body.groups.find((g) => g.groupCode === TEST_GROUP)
    expect(group?.codes.map((c) => c.code)).toEqual(['ALIVE'])
  })

  it('삭제된 그룹은 통째로 빠진다', async () => {
    const now = dbNow()
    await db.insert(codeGroups).values({
      groupCode: TEST_GROUP, name: '지워진 그룹',
      createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
      deletedAt: now, deletedBy: 0,
    })

    const auth = await tokenFor(await makeUser('ccodes@example.com'))
    const { body } = await get(auth)

    expect(body.groups.find((g) => g.groupCode === TEST_GROUP)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter api test -- codes.test.ts`
Expected: FAIL — `/api/codes`가 404다.

- [ ] **Step 3: 라우트를 만든다**

`apps/api/src/routes/codes.ts`

```ts
import type { FastifyInstance } from 'fastify'
import { asc, isNull } from 'drizzle-orm'
import type { CodeGroupPayload, CodesResponse } from '@daily/shared'
import { db } from '../db/pool.ts'
import { codeGroups, codes } from '../db/schema.ts'
import { requireAuth } from '../plugins/require-auth.ts'

/**
 * 공통코드 전체를 내려보낸다.
 *
 * **`sync/` 계층과 무관하다.** 사용자가 만드는 데이터가 아니라 push 할 것이
 * 없고, pull 커서에 얹을 이유도 없다. 동기화 엔진을 건드리지 않는 것이 이
 * 설계의 핵심 제약이다.
 *
 * 인증 뒤에 두는 이유는 코드가 비밀이라서가 아니라, 인증 전 화면(로그인·
 * 회원가입)에 코드가 필요 없기 때문이다. 공개 서비스에서 인증 없이 열어둘
 * 이유가 없는 것은 열지 않는다.
 *
 * 조건부 요청(ETag)은 넣지 않는다. 코드는 수십 건 규모다.
 */
export async function codesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/codes', { preHandler: requireAuth }, async (): Promise<CodesResponse> => {
    const groupRows = await db.select({
      groupCode: codeGroups.groupCode,
      name: codeGroups.name,
    }).from(codeGroups)
      .where(isNull(codeGroups.deletedAt))
      .orderBy(asc(codeGroups.groupCode))

    const codeRows = await db.select({
      groupCode: codes.groupCode,
      code: codes.code,
      name: codes.name,
      sortOrder: codes.sortOrder,
    }).from(codes)
      .where(isNull(codes.deletedAt))
      // 클라이언트가 다시 정렬하지 않아도 되게 여기서 끝낸다.
      .orderBy(asc(codes.groupCode), asc(codes.sortOrder))

    const byGroup = new Map<string, CodeGroupPayload>(
      groupRows.map((g) => [g.groupCode, { ...g, codes: [] }]),
    )
    for (const row of codeRows) {
      // 그룹이 삭제됐는데 코드가 남아 있을 수 있다. 그 코드는 내려보내지 않는다.
      byGroup.get(row.groupCode)?.codes.push({
        code: row.code, name: row.name, sortOrder: row.sortOrder,
      })
    }

    return { groups: [...byGroup.values()] }
  })
}
```

- [ ] **Step 4: 라우트를 등록한다**

`apps/api/src/app.ts`의 import에 추가하고,

```ts
import { codesRoutes } from './routes/codes.ts'
```

`syncRoutes` 등록 아래에 붙인다.

```ts
  await app.register(codesRoutes, { prefix: '/api' })
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter api test -- codes.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

Run: `pnpm --filter api test`
Expected: PASS

```bash
git add apps/api/src/routes/codes.ts apps/api/src/routes/codes.test.ts apps/api/src/app.ts
git commit -m "feat(api): 공통코드 조회 라우트

sync 계층과 무관하다. 사용자가 만드는 데이터가 아니라 push 할 것이
없고 pull 커서에 얹을 이유도 없다. 동기화 엔진을 건드리지 않는 것이
이 설계의 핵심 제약이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: sync 레지스트리의 장르 검증

**Files:**
- Modify: `apps/api/src/sync/registry.ts`
- Modify: `apps/api/src/sync/push.ts`
- Modify: `apps/api/src/routes/sync.test.ts`
- Modify: `.claude/roles/database.md`

**Interfaces:**
- Consumes: Task 1의 `codes` 테이블, Task 3의 `CODE_GROUP`·`BookPayload`
- Produces: `SyncTableDef.validate?(payload): Promise<string | null>` — 통과면 `null`, 실패면 사용자에게 보여줄 사유

**핵심:** 검증은 **존재만** 본다. 삭제된 코드도 통과시킨다. `isNull(codes.deletedAt)`을 넣지 마라 — 이유는 아래 주석에 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/api/src/routes/sync.test.ts`의 `describe('독서 — 부모-자식 동기화', …)` 안, `bookPayload` 헬퍼 아래에 추가한다. import에 `codes`를 더한다.

```ts
  it('유효한 장르 코드는 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ genre: 'NOVEL' }),
    }])

    expect(body.results[0]?.status).toBe('APPLIED')
    const [row] = await db.select().from(books)
    expect(row?.genre).toBe('NOVEL')
  })

  it('장르 미지정도 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload(),
    }])

    expect(body.results[0]?.status).toBe('APPLIED')
    const [row] = await db.select().from(books)
    expect(row?.genre).toBeNull()
  })

  // CONFLICT가 아니다 — 부모를 기다리는 상황이 아니라 영구히 틀린 값이다.
  // 500도 아니다 — 500은 재시도 대상이라 큐가 영원히 막힌다.
  it('모르는 장르 코드는 REJECTED다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ genre: 'NO_SUCH_GENRE' }),
    }])

    expect(body.results[0]?.status).toBe('REJECTED')
    expect(await db.select().from(books)).toHaveLength(0)
  })

  /**
   * 관리자가 장르를 지우는 순간 그 장르를 쓰던 사용자의 오프라인 수정이 전부
   * 버려지면 안 된다. 사용자는 잘못한 것이 없는데 기록을 잃는다.
   * resolveParentId가 liveOwnedBy가 아니라 ownedBy를 쓰는 것과 같은 판단이다.
   */
  it('삭제된 장르 코드도 통과한다', async () => {
    const now = dbNow()
    await db.update(codes)
      .set({ deletedAt: now, deletedBy: 0 })
      .where(and(eq(codes.groupCode, 'BOOK_GENRE'), eq(codes.code, 'ETC')))

    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ genre: 'ETC' }),
    }])

    expect(body.results[0]?.status).toBe('APPLIED')

    // 다음 테스트를 위해 되돌린다. 시드 데이터는 resetDb가 복구해 주지 않는다.
    await db.update(codes)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(codes.groupCode, 'BOOK_GENRE'), eq(codes.code, 'ETC')))
  })

  it('pull 페이로드에 장르가 실린다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ genre: 'TECH' }),
    }])
    await settle()

    const { body } = await pull(auth)
    const book = body.changes.find((c) => c.table === 'books')
    expect(book?.payload.genre).toBe('TECH')
  })
```

`import { and, eq } from 'drizzle-orm'`이 파일에 이미 있는지 확인하고, 없으면 더한다.

**주의:** `resetDb()`가 `TRUNCATE ... CASCADE`로 모든 테이블을 비우므로 **시드된 코드도 매 테스트마다 사라진다.** `sync.test.ts`의 `beforeEach`가 `resetDb()`를 부르므로, 위 테스트들이 통과하려면 코드 시드를 다시 넣어야 한다. `beforeEach`에 다음을 추가하라.

```ts
beforeEach(async () => {
  await resetDb()
  await seedBookGenres()   // 아래에 정의
  app = await buildApp()
  await app.ready()
})

/** resetDb가 마이그레이션 시드까지 지우므로 테스트에서 다시 넣는다. */
async function seedBookGenres() {
  const now = dbNow()
  const audit = { createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0 }
  await db.insert(codeGroups)
    .values({ groupCode: 'BOOK_GENRE', name: '독서 장르', ...audit })
  await db.insert(codes).values(
    [['NOVEL', '소설'], ['ESSAY', '에세이'], ['HUMANITIES', '인문'],
     ['SCIENCE', '과학'], ['TECH', '기술'], ['ECONOMY', '경제'], ['ETC', '기타']]
      .map(([code, name], i) => ({
        groupCode: 'BOOK_GENRE', code: code!, name: name!, sortOrder: i + 1, ...audit,
      })),
  )
}
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter api test -- sync.test.ts`
Expected: FAIL — 모르는 코드가 `APPLIED`로 통과한다(검증이 없다).

- [ ] **Step 3: 레지스트리에 `validate` 훅을 더한다**

`apps/api/src/sync/registry.ts`의 `SyncTableDef`에 필드를 더한다.

```ts
  parent?: ParentRef
  /**
   * DB를 봐야 하는 검증. 통과면 `null`, 실패면 사용자에게 보여줄 사유.
   *
   * 실패는 **REJECTED**다 — CONFLICT가 아니다. CONFLICT는 "부모가 아직
   * 안 왔다"이고 재시도로 풀리지만, 여기서 걸리는 값은 재시도해도 계속 틀리다.
   * 큐에 남기면 그 항목이 영원히 빠지지 않는다.
   *
   * zod로 막을 수 없는 것만 여기 온다. 값 집합이 DB에 있는 공통코드가 그렇다.
   */
  validate?(payload: TPayload): Promise<string | null>
```

`books` 항목에 `validate`를 더한다. import도 함께.

```ts
import { and, eq } from 'drizzle-orm'
import { CODE_GROUP, /* …기존 import */ } from '@daily/shared'
import { bookNotes, books, codes, expenseCategories, expenses } from '../db/schema.ts'
import { db } from '../db/pool.ts'
```

```ts
  books: define<BookPayload>({
    table: books,
    payload: bookPayloadSchema,
    hasOccurredOn: false,
    /**
     * 장르가 실제 코드인지 확인한다.
     *
     * **`deleted_at`을 보지 않는다 — 존재만 본다.** 살아있는 코드만 통과시키면,
     * 관리자가 장르 하나를 지우는 순간 그 장르를 쓰던 사용자의 오프라인 수정이
     * 전부 REJECTED가 되어 버려진다. 사용자는 잘못한 것이 없는데 기록을 잃는다.
     * `resolveParentId`가 `liveOwnedBy`가 아니라 `ownedBy`를 쓰는 것과 같다.
     *
     * 새로 고를 수 없게 막는 것은 화면의 몫이다 — 삭제된 코드는 `GET /codes`에서
     * 빠지므로 선택 목록에 뜨지 않는다.
     */
    validate: async (p: BookPayload) => {
      if (p.genre === null) return null
      const [found] = await db.select({ code: codes.code }).from(codes)
        .where(and(
          eq(codes.groupCode, CODE_GROUP.BOOK_GENRE),
          eq(codes.code, p.genre),
        ))
      return found ? null : '알 수 없는 장르입니다.'
    },
    toColumns: (p: BookPayload) => ({
      title: p.title,
      author: p.author,
      summary: p.summary,
      status: p.status,
      startedOn: p.startedOn,
      finishedOn: p.finishedOn,
      genre: p.genre,
    }),
    toPayload: (r) => ({
      title: r.title,
      author: r.author,
      summary: r.summary,
      status: r.status,
      startedOn: r.startedOn,
      finishedOn: r.finishedOn,
      genre: r.genre,
    }),
  }),
```

- [ ] **Step 4: `push.ts`에서 훅을 부른다**

`apps/api/src/sync/push.ts`의 `applyUpsert`에서 부모 해석 **뒤**, `toColumns` **앞**에 넣는다.

```ts
  const parent = await resolveParentId(def, userId, parsed.data as ColumnValues)
  if (!parent.ok) {
    // 부모 없음은 영구 실패가 아니라 "아직 이르다"다. 큐에 남겨 재시도하게 한다.
    return { ...base, status: 'CONFLICT', reason: parent.reason }
  }

  // DB를 봐야 하는 검증. 실패는 영구 실패다 — 재시도해도 계속 틀린 값이다.
  if (def.validate) {
    const reason = await def.validate(parsed.data)
    if (reason !== null) return { ...base, status: 'REJECTED', reason }
  }

  const domain = def.toColumns(parsed.data, parent.id)
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter api test -- sync.test.ts`
Expected: PASS

- [ ] **Step 6: 규칙 문서를 고친다**

`.claude/roles/database.md`의 코드성 데이터 절 맨 아래, "코드값과 자유 입력 텍스트가…" 문단 **앞**에 넣는다.

```markdown
### 예외 — 공통코드 테이블

**`code_groups`·`codes` 테이블로 관리하는 코드는 위 규칙에서 빠진다.** 값 집합이 런타임 데이터라 `CHECK`로 표현할 수 없고, zod enum도 만들 수 없다. 대신 서버가 sync 페이로드 검증 단계에서 `codes`와 대조하고, 모르는 코드는 `REJECTED`로 돌려준다.

검증은 **존재만 본다.** 삭제된 코드도 통과시킨다 — 관리자가 코드를 지우는 순간 그 코드를 쓰던 사용자의 오프라인 수정이 전부 버려지면 안 된다. 새로 고를 수 없게 막는 것은 `GET /codes`가 삭제된 코드를 내려보내지 않는 것으로 처리한다.

현재 `BOOK_GENRE` 하나가 이 방식이다. 나머지 코드 그룹은 기존대로 `codes.ts` + `CHECK` + zod enum을 쓴다.

값을 대문자로 관리한다는 규칙은 공통코드에도 그대로 적용된다.
```

- [ ] **Step 7: 확인하고 커밋한다**

Run: `pnpm --filter api test && pnpm build`
Expected: PASS

```bash
git add apps/api/src/sync/registry.ts apps/api/src/sync/push.ts \
        apps/api/src/routes/sync.test.ts .claude/roles/database.md
git commit -m "feat(api): 장르 코드를 codes 테이블과 대조해 검증한다

SyncTableDef에 validate 훅을 더한다. 실패는 REJECTED다 — CONFLICT는
부모를 기다리는 상황이고 재시도로 풀리지만, 여기서 걸리는 값은
재시도해도 계속 틀리다. 큐에 남기면 영원히 빠지지 않는다.

검증은 존재만 본다. 삭제된 코드도 통과시킨다 — 관리자가 장르를 지우는
순간 그 장르를 쓰던 사용자의 오프라인 수정이 전부 버려지면 안 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 웹 코드 캐시

**Files:**
- Modify: `apps/web/src/db/index.ts`
- Create: `apps/web/src/codes/repository.ts`
- Create: `apps/web/src/codes/refresh.ts`
- Create: `apps/web/src/codes/label.ts`
- Create: `apps/web/src/codes/codes.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 3의 `CODE_GROUP`·`CodesResponse`, 기존 `apiFetch`(`../lib/apiClient.ts`)
- Produces:
  - `interface LocalCode { groupCode: string; code: string; name: string; sortOrder: number }`
  - `db.codes: Table<LocalCode, [string, string]>` (복합 기본키 `[groupCode+code]`)
  - `listCodes(groupCode: string): Promise<LocalCode[]>` — `sortOrder` 오름차순
  - `replaceCodes(response: CodesResponse): Promise<void>`
  - `refreshCodes(): Promise<void>`
  - `codeLabel(list: LocalCode[], value: string | null): string | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/codes/codes.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodesResponse } from '@daily/shared'
import { db } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { codeLabel } from './label.ts'
import { refreshCodes } from './refresh.ts'
import { listCodes, replaceCodes } from './repository.ts'

const fetchMock = vi.fn()

const response = (codes: { code: string; name: string; sortOrder: number }[]): CodesResponse => ({
  groups: [{ groupCode: 'BOOK_GENRE', name: '독서 장르', codes }],
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken('token')
  await db.codes.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('코드 캐시', () => {
  it('응답을 저장하고 그룹으로 조회한다', async () => {
    await replaceCodes(response([
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
      { code: 'ESSAY', name: '에세이', sortOrder: 2 },
    ]))

    const list = await listCodes('BOOK_GENRE')
    expect(list.map((c) => c.code)).toEqual(['NOVEL', 'ESSAY'])
    expect(list[0]?.name).toBe('소설')
  })

  it('sortOrder 순으로 돌려준다', async () => {
    await replaceCodes(response([
      { code: 'ESSAY', name: '에세이', sortOrder: 2 },
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
    ]))

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL', 'ESSAY'])
  })

  // 서버에서 지워진 코드가 캐시에 남으면 선택 목록에 계속 뜬다.
  it('갱신 시 사라진 코드는 캐시에서도 빠진다', async () => {
    await replaceCodes(response([
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
      { code: 'GONE', name: '사라질것', sortOrder: 2 },
    ]))
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  it('없는 그룹은 빈 배열이다', async () => {
    expect(await listCodes('NO_SUCH_GROUP')).toEqual([])
  })
})

describe('refreshCodes', () => {
  it('응답을 캐시에 반영한다', async () => {
    fetchMock.mockResolvedValueOnce(
      json(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }])),
    )

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  // 네트워크가 없다고 장르 목록이 사라지면 안 된다.
  it('요청이 실패해도 기존 캐시를 지우지 않는다', async () => {
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  it('서버가 오류를 주어도 기존 캐시를 지키다', async () => {
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))
    fetchMock.mockResolvedValueOnce(json({ error: { message: '서버 오류' } }, 500))

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })
})

describe('codeLabel', () => {
  const list = [
    { groupCode: 'BOOK_GENRE', code: 'NOVEL', name: '소설', sortOrder: 1 },
  ]

  it('코드값을 라벨로 바꾼다', () => {
    expect(codeLabel(list, 'NOVEL')).toBe('소설')
  })

  it('미지정은 null이다', () => {
    expect(codeLabel(list, null)).toBeNull()
  })

  // 관리자가 지운 장르를 쓰던 기록이 빈칸이 되면 사용자는 자기 기록이 손상된
  // 것으로 읽는다. 라벨을 모르면 코드값이라도 보여준다.
  it('캐시에 없는 코드값은 코드값 그대로 돌려준다', () => {
    expect(codeLabel(list, 'GONE')).toBe('GONE')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- codes/codes.test.ts`
Expected: FAIL — `./repository.ts`가 없다.

- [ ] **Step 3: Dexie version(4)를 더한다**

`apps/web/src/db/index.ts`에 타입을 더한다. `LocalBookNote` 아래에 둔다.

```ts
/**
 * 공통코드 캐시.
 *
 * 동기화 대상이 아니다 — `LocalRecord`를 확장하지 않는다. 사용자가 만드는
 * 데이터가 아니라 서버에서 통째로 받아 덮어쓰는 읽기 전용 사본이다.
 */
export interface LocalCode {
  groupCode: string
  code: string
  name: string
  sortOrder: number
}
```

클래스에 필드를 더한다. **`EntityTable`이 아니라 `Table`을 쓴다** — `EntityTable`은 단일 키 속성명을 받는 타입이라 복합 기본키를 표현할 수 없다. 파일 맨 위 import를 `import Dexie, { type EntityTable, type Table } from 'dexie'`로 넓힌다.

```ts
  codes!: Table<LocalCode, [string, string]>
```

생성자의 `version(3)` 아래에 붙인다.

```ts
    // 복합 기본키다. 그룹이 다르면 같은 코드값이 존재할 수 있다.
    this.version(4).stores({
      codes: '[groupCode+code], groupCode',
    })
```

- [ ] **Step 4: 저장소를 만든다**

`apps/web/src/codes/repository.ts`

```ts
import type { CodesResponse } from '@daily/shared'
import { db, type LocalCode } from '../db/index.ts'

/**
 * 공통코드 캐시에 닿는 통로.
 *
 * `pages/<기능>/`이 아니라 `src/` 아래 공용 자리에 있는 이유가 둘이다.
 * 코드 갱신을 거는 주체가 앱 셸(`App.tsx`)이라 기능 폴더에 두면 셸이 기능
 * 폴더를 임포트하게 되고, 애초에 이 테이블의 목적이 여러 업무가 함께 쓰는
 * 것이다.
 */

/** 그룹 하나의 코드를 `sortOrder` 순으로 돌려준다. */
export async function listCodes(groupCode: string): Promise<LocalCode[]> {
  const rows = await db.codes.where('groupCode').equals(groupCode).toArray()
  return rows.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 응답으로 캐시를 통째로 교체한다.
 *
 * 그룹별로 지우고 다시 넣는다. 덮어쓰기만 하면 **서버에서 지워진 코드가 캐시에
 * 영원히 남아** 선택 목록에 계속 뜬다.
 */
export async function replaceCodes(response: CodesResponse): Promise<void> {
  const rows: LocalCode[] = response.groups.flatMap((group) =>
    group.codes.map((c) => ({
      groupCode: group.groupCode,
      code: c.code,
      name: c.name,
      sortOrder: c.sortOrder,
    })),
  )

  await db.transaction('rw', db.codes, async () => {
    for (const group of response.groups) {
      await db.codes.where('groupCode').equals(group.groupCode).delete()
    }
    await db.codes.bulkPut(rows)
  })
}
```

- [ ] **Step 5: 갱신 함수를 만든다**

`apps/web/src/codes/refresh.ts`

```ts
import type { CodesResponse } from '@daily/shared'
import { apiFetch } from '../lib/apiClient.ts'
import { replaceCodes } from './repository.ts'

/**
 * 서버에서 공통코드를 받아 캐시를 갱신한다. 인증 직후 한 번 부른다.
 *
 * **실패해도 던지지 않고 기존 캐시를 남긴다.** 네트워크가 없다고 장르 목록이
 * 사라지면, 오프라인에서 책을 등록하려던 사용자가 장르를 고를 수 없게 된다.
 * 오프라인 입력이 이 앱의 존재 이유이므로 그 경로를 막으면 안 된다.
 */
export async function refreshCodes(): Promise<void> {
  try {
    const res = await apiFetch('/codes')
    if (!res.ok) return
    await replaceCodes((await res.json()) as CodesResponse)
  } catch {
    // 오프라인이거나 서버가 죽었다. 기존 캐시로 계속 간다.
  }
}
```

- [ ] **Step 6: 라벨 헬퍼를 만든다**

`apps/web/src/codes/label.ts`

```ts
import type { LocalCode } from '../db/index.ts'

/**
 * 코드값을 화면 라벨로 바꾼다.
 *
 * **캐시에 없으면 코드값을 그대로 돌려준다.** 관리자가 지운 장르를 쓰던 기록이
 * 빈칸이 되면 사용자는 자기 기록이 손상된 것으로 읽는다. 라벨을 모르더라도
 * 무언가 붙어 있다는 사실은 보여야 한다.
 */
export function codeLabel(list: LocalCode[], value: string | null): string | null {
  if (value === null) return null
  return list.find((c) => c.code === value)?.name ?? value
}
```

- [ ] **Step 7: 앱 셸에서 갱신을 건다**

`apps/web/src/App.tsx`의 import에 추가하고,

```tsx
import { refreshCodes } from './codes/refresh.ts'
```

동기화 트리거 `useEffect` 안, `startSync` 앞에 한 줄 더한다.

```tsx
  useEffect(() => {
    if (status !== 'AUTHENTICATED' || userId === undefined) return undefined
    // 코드 캐시는 동기화와 독립이다. 실패해도 던지지 않으므로 기다리지 않는다.
    void refreshCodes()
    void startSync(userId)
    return () => stopSync()
  }, [status, userId, startSync, stopSync])
```

- [ ] **Step 8: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- codes/codes.test.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

Run: `pnpm --filter web test && pnpm build`
Expected: PASS

```bash
git add apps/web/src/db/index.ts apps/web/src/codes/ apps/web/src/App.tsx
git commit -m "feat(web): 공통코드 캐시

sync/의 push·pull을 타지 않는다. 서버에서 통째로 받아 덮어쓰는 읽기
전용 사본이다.

갱신 실패는 던지지 않고 기존 캐시를 남긴다. 네트워크가 없다고 장르
목록이 사라지면 오프라인에서 책을 등록하려던 사용자가 장르를 고를 수
없게 된다 — 오프라인 입력이 이 앱의 존재 이유다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 화면에 장르 반영

**Files:**
- Modify: `apps/web/src/sync/apply.ts`
- Modify: `apps/web/src/db/index.ts` (`LocalBook.genre`)
- Modify: `apps/web/src/pages/book/repository.ts`
- Modify: `apps/web/src/pages/book/repository.test.ts`
- Modify: `apps/web/src/pages/book/BookForm.tsx`
- Modify: `apps/web/src/pages/book/BookListPage.tsx`
- Modify: `apps/web/src/pages/book/BookListPage.test.tsx`
- Modify: `apps/web/src/pages/book/BookDetailPage.tsx`
- Modify: `apps/web/src/pages/book/BookDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 6의 `listCodes`·`codeLabel`·`LocalCode`, Task 3의 `CODE_GROUP`
- Produces: `BookInput.genre: string | null`, `LocalBook.genre: string | null`, `BookForm`의 `genres: LocalCode[]` prop

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/book/repository.test.ts`의 `book()` 헬퍼에 `genre: null`을 더하고, `describe('책 저장', …)`의 페이로드 키 테스트를 고친다.

```ts
const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', author: null, summary: null,
  status: 'READING' as const, startedOn: null, finishedOn: null,
  genre: null, ...over,
})
```

```ts
  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveBook(USER, book())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort())
      .toEqual(['author', 'finishedOn', 'genre', 'startedOn', 'status', 'summary', 'title'])
  })

  it('장르를 저장하고 읽어온다', async () => {
    const uuid = await saveBook(USER, book({ genre: 'NOVEL' }))
    expect((await getBook(USER, uuid))?.genre).toBe('NOVEL')
  })

  it('미지정으로 저장하면 장르가 null이다', async () => {
    const uuid = await saveBook(USER, book())
    expect((await getBook(USER, uuid))?.genre).toBeNull()
    const [row] = await takeBatch(1)
    expect((row!.payload as { genre: unknown }).genre).toBeNull()
  })
```

`apps/web/src/pages/book/BookListPage.test.tsx`에 추가한다. import에 `db`가 이미 있다.

```ts
  it('장르 라벨을 보여준다', async () => {
    await db.codes.bulkPut([
      { groupCode: 'BOOK_GENRE', code: 'NOVEL', name: '소설', sortOrder: 1 },
    ])
    await saveBook(USER.id, {
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null, genre: 'NOVEL',
    })

    renderPage()

    expect(await screen.findByText('소설')).toBeInTheDocument()
  })

  // 관리자가 지운 장르를 쓰던 기록이 빈칸이 되면 안 된다.
  it('캐시에 없는 장르는 코드값 그대로 보여준다', async () => {
    await saveBook(USER.id, {
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null, genre: 'GONE',
    })

    renderPage()

    expect(await screen.findByText('GONE')).toBeInTheDocument()
  })

  it('장르 선택지가 sortOrder 순으로 뜬다', async () => {
    await db.codes.bulkPut([
      { groupCode: 'BOOK_GENRE', code: 'ESSAY', name: '에세이', sortOrder: 2 },
      { groupCode: 'BOOK_GENRE', code: 'NOVEL', name: '소설', sortOrder: 1 },
    ])

    renderPage()
    await screen.findByText('등록한 책이 없습니다.')
    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))

    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent))
      .toEqual(['미지정', '소설', '에세이'])
  })
```

`beforeEach`에 `await db.codes.clear()`를 더한다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book`
Expected: FAIL — `genre`가 페이로드 키에 없고, 라벨이 화면에 없다.

- [ ] **Step 3: 로컬 타입과 applier에 `genre`를 더한다**

`apps/web/src/db/index.ts`의 `LocalBook`에 추가한다.

```ts
  finishedOn: string | null
  /** 장르 코드값. 라벨은 codes 캐시에서 찾는다 */
  genre: string | null
```

`apps/web/src/sync/apply.ts`의 `books` applier에 추가한다.

```ts
    finishedOn: (r.payload.finishedOn as string | null) ?? null,
    genre: (r.payload.genre as string | null) ?? null,
```

- [ ] **Step 4: 저장소에 `genre`를 더한다**

`apps/web/src/pages/book/repository.ts`의 `BookInput`에 추가한다.

```ts
  finishedOn: string | null
  /** 장르 코드값 (codes의 BOOK_GENRE 그룹). 미지정이면 null */
  genre: string | null
```

`saveBook`의 `db.books.put`과 `enqueue`의 `payload` 양쪽에 `genre: input.genre`를 더한다. **둘 다 고쳐야 한다** — 하나만 고치면 로컬에는 남고 서버로는 안 가거나 그 반대가 된다.

- [ ] **Step 5: `BookForm`에 장르 선택을 더한다**

`apps/web/src/pages/book/BookForm.tsx`의 import와 Props에 추가한다.

```tsx
import type { LocalBook, LocalCode } from '../../db/index.ts'
```

```tsx
interface Props {
  initial?: LocalBook
  genres: LocalCode[]
  onSubmit: (input: BookInput) => Promise<void>
  onCancel?: () => void
}

export default function BookForm({ initial, genres, onSubmit, onCancel }: Props) {
  // …기존 useState들 아래
  const [genre, setGenre] = useState(initial?.genre ?? '')
```

`onSubmit` 호출에 필드를 더한다.

```tsx
        startedOn: startedOn || null,
        finishedOn: finishedOn || null,
        genre: genre || null,
```

저자 `<label>` 아래에 선택을 넣는다.

```tsx
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">장르</span>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">미지정</option>
          {genres.map((g) => (
            <option key={g.code} value={g.code}>{g.name}</option>
          ))}
        </select>
      </label>
```

- [ ] **Step 6: 목록 화면에 반영한다**

`apps/web/src/pages/book/BookListPage.tsx`의 import에 추가한다.

```tsx
import { CODE_GROUP } from '@daily/shared'
import { codeLabel } from '../../codes/label.ts'
import { listCodes } from '../../codes/repository.ts'
```

`books`·`noteCounts` 옆에 코드를 읽는다.

```tsx
  const genres = useLiveQuery(() => listCodes(CODE_GROUP.BOOK_GENRE), [], [])
```

`BookForm`에 prop을 넘긴다.

```tsx
        <BookForm genres={genres} onSubmit={handleSubmit} onCancel={() => setAdding(false)} />
```

목록 각 행의 상태 배지 아래에 라벨을 넣는다. `<div className="flex shrink-0 flex-col items-end gap-1">` 안, 상태 배지 `<span>` 다음이다.

```tsx
                    {codeLabel(genres, b.genre) && (
                      <span className="text-xs text-gray-500">
                        {codeLabel(genres, b.genre)}
                      </span>
                    )}
```

- [ ] **Step 7: 상세 화면에 반영한다**

`apps/web/src/pages/book/BookDetailPage.tsx`의 import에 세 줄을 더한다.

```tsx
import { CODE_GROUP } from '@daily/shared'
import { codeLabel } from '../../codes/label.ts'
import { listCodes } from '../../codes/repository.ts'
```

`notes` 옆에 코드를 읽는다.

```tsx
  const genres = useLiveQuery(() => listCodes(CODE_GROUP.BOOK_GENRE), [], [])
```

`BookForm`에 prop을 넘긴다.

```tsx
        <BookForm initial={book} genres={genres} onSubmit={handleEdit} onCancel={() => setEditing(false)} />
```

상태 배지 옆에 라벨을 넣는다. `{period && …}` 앞이다.

```tsx
            {codeLabel(genres, book.genre) && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {codeLabel(genres, book.genre)}
              </span>
            )}
```

`BookDetailPage.test.tsx`의 `makeBook()`에 `genre: null`을 더한다. `beforeEach`에 `await db.codes.clear()`도 더한다.

- [ ] **Step 8: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test`
Expected: PASS

- [ ] **Step 9: 전체 검증**

Run: `pnpm build && pnpm test`
Expected: 둘 다 성공

- [ ] **Step 10: 커밋**

```bash
git add apps/web/src/
git commit -m "feat(web): 책 등록·목록·상세에 장르

라벨은 codes 캐시에서 찾고, 캐시에 없으면 코드값을 그대로 보여준다.
관리자가 지운 장르를 쓰던 기록이 빈칸이 되면 사용자는 자기 기록이
손상된 것으로 읽는다.

장르 필터는 넣지 않는다. 상태 필터가 이미 있고 두 축이 겹치면 목록
UI가 복잡해진다. 요구가 나오면 그때 추가한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 마무리 확인

커밋 대상이 아니라 점검용이다.

- [ ] `pnpm build && pnpm test` 통과
- [ ] `pnpm --filter api db:migrate && pnpm --filter api db:comments` 재실행이 멱등한지 확인
- [ ] 오프라인 시나리오: DevTools 오프라인 → 책 등록 시 장르 목록이 캐시에서 뜨는지
- [ ] 배포 순서 확인 — `SCHEMA_VERSION`이 3이므로 **서버를 먼저** 올린다. 마이그레이션은 서버 배포에 포함된다

---

## 설계 문서와 달라진 점

| 항목 | 설계 §10 | 이 계획 | 이유 |
|---|---|---|---|
| 규칙 문서 갱신 | 별도 8단계 | Task 5에 포함 | 규칙 문안이 서술하는 검증이 Task 5에서 생긴다. 그 전에 적으면 문서가 없는 동작을 설명하게 된다 |

그 외는 설계 문서의 순서와 내용을 그대로 따른다.
