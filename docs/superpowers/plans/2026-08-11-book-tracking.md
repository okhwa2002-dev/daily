# 독서 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 책 목록과 감상평을 기록하는 화면을 추가하고, 그 과정에서 처음 실행되는 부모-자식 동기화 경로를 검증한다.

**Architecture:** DB 테이블(`books`, `book_notes`)은 이미 있다. 이 계획은 그 위의 shared 스키마 → 서버 레지스트리 → 로컬 Dexie → 화면 순으로 배선을 채운다. 화면은 Dexie만 읽고 서버 통신은 `sync/` 계층이 전담하는 기존 규칙을 그대로 따른다.

**Tech Stack:** TypeScript, zod(shared), Fastify + Drizzle(api), React 19 + Dexie + react-router + Tailwind v4(web), vitest.

설계 문서: [2026-08-11-book-tracking-design.md](../specs/2026-08-11-book-tracking-design.md)

## Global Constraints

- 코드성 값은 대문자다 — `status`는 `READING | DONE | WISHLIST`. 컬럼명·테이블명은 snake_case 소문자.
- 금액·날짜를 포함한 모든 시각은 KST 벽시계 문자열. `TIMESTAMPTZ`를 쓰지 않는다.
- 도메인 레코드의 모양은 `packages/shared`의 zod 스키마가 유일한 정의다. 타입을 양쪽에 복사하지 않는다.
- 모든 조회·수정·삭제는 `user_id`(로컬은 `userId`)로 소유권을 건다. 요청 본문의 사용자 ID는 신뢰하지 않는다.
- 물리 삭제 금지. 삭제는 `deletedAt` 툼스톤 + 아웃박스 `DELETE`.
- `pages/book/`은 `pages/expense/`를 임포트하지 않는다.
- 감상평 본문·책 제목 등 사용자 기록 데이터를 로그로 출력하지 않는다.
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- 작업 브랜치는 `feat/book-tracking`이다. 이미 만들어져 있다.

## 작업 순서에 대해

설계 문서 §11은 `shared → registry → 결함 수정 → Dexie` 순서를 적었다. **실제 순서는 아래와 같이 바꾼다.**

`SYNC_TABLE`에 `books`를 더하는 순간 `SYNC_REGISTRY`(api)와 `APPLIERS`(web)가 **동시에** 컴파일 에러가 난다. 둘 다 `Record<SyncTable, …>`이기 때문이다. 그래서 enum 확장과 양쪽 소비처 수정은 쪼갤 수 없는 하나의 단위다(Task 4). 그 단위를 작게 유지하려면 결함 수정과 스키마·스토어 준비가 먼저 끝나 있어야 한다.

결과적으로 "결함을 먼저 고친다"는 설계 의도는 더 강해진다 — 결함 3건이 독서 코드가 한 줄이라도 들어오기 전에 끝난다.

| Task | 내용 | 커밋 시점에 `pnpm build`가 통과하는가 |
|---|---|---|
| 1 | 결함 (c) CONFLICT 재시도 상한 | O |
| 2 | shared 페이로드 스키마 (enum 미변경) | O |
| 3 | Dexie version(3) + 로컬 타입 | O |
| 4 | `SYNC_TABLE` 확장 + registry + APPLIERS + 결함 (a)(b) | O |
| 5 | `pages/book/repository.ts` | O |
| 6 | `TabBar` + 라우팅 | O |
| 7 | `BookListPage` + `BookForm` | O |
| 8 | `BookDetailPage` + `BookNoteForm` | O |

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `apps/web/src/components/TabBar.tsx` | 하단 탭 내비게이션. 항목 배열 하나 |
| `apps/web/src/pages/book/repository.ts` | 책·감상평의 Dexie 읽기/쓰기 + 아웃박스 적재 |
| `apps/web/src/pages/book/repository.test.ts` | 위의 테스트 |
| `apps/web/src/pages/book/BookForm.tsx` | 책 등록·수정 폼 |
| `apps/web/src/pages/book/BookListPage.tsx` | 상태 필터 + 목록 |
| `apps/web/src/pages/book/BookListPage.test.tsx` | 위의 테스트 |
| `apps/web/src/pages/book/BookNoteForm.tsx` | 감상평 작성 폼 |
| `apps/web/src/pages/book/BookDetailPage.tsx` | 책 상세 + 감상평 목록 |
| `apps/web/src/pages/book/BookDetailPage.test.tsx` | 위의 테스트 |
| `packages/shared/src/sync.test.ts` | 페이로드 스키마 테스트 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `packages/shared/src/sync.ts` | `SYNC_TABLE` 확장, `SCHEMA_VERSION` 2, 책·감상평 페이로드 스키마 |
| `apps/api/src/sync/registry.ts` | `books`·`book_notes` 두 항목 |
| `apps/api/src/routes/sync.test.ts` | 부모-자식 케이스 |
| `apps/web/src/db/index.ts` | version(3) 스토어, `LocalBook`·`LocalBookNote` |
| `apps/web/src/sync/apply.ts` | `APPLIERS` 두 항목, `recordServerId` 맵 전환 |
| `apps/web/src/sync/apply.test.ts` | (없으면 신규) `recordServerId` 테이블별 기록 |
| `apps/web/src/sync/engine.ts` | CONFLICT 재시도 상한, `clearLocalData` 순회 |
| `apps/web/src/sync/engine.test.ts` | 위의 테스트 |
| `apps/web/src/App.tsx` | `/books`, `/books/:clientUuid` 라우트 + 탭바 |

---

## Task 1: CONFLICT 재시도 상한

**Files:**
- Modify: `apps/web/src/sync/engine.ts:125-130`
- Test: `apps/web/src/sync/engine.test.ts`

**Interfaces:**
- Consumes: 기존 `quarantine(row, result)`, `markRetry(seq, error)`, `OutboxRow.tryCount`
- Produces: 없음 (동작 변경만)

**왜 먼저인가:** 부모 책이 `REJECTED`로 격리되면 그 감상평은 영원히 `CONFLICT`를 반복한다. `pendingCount()`가 0이 되지 않아 로그아웃할 때마다 "동기화되지 않은 기록 N건" 경고가 뜨고 사용자는 없앨 방법이 없다. 지출은 부모가 `required: false`라 이 경로에 못 들어갔고, 독서가 처음 밟는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/sync/engine.test.ts`의 `describe('push', …)` 안, 기존 `'CONFLICT면 큐에 남는다 — 영구 실패가 아니다'` 바로 아래에 추가한다.

```ts
  it('CONFLICT가 상한을 넘으면 격리하고 큐에서 뺀다', async () => {
    await queueExpense()
    // 이 항목은 이미 9번 재시도했다. 이번이 10번째다.
    const [queued] = await takeBatch(1)
    await db.outbox.update(queued!.seq, { tryCount: 9 })

    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'CONFLICT',
        reason: '부모 레코드가 아직 서버에 없습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    // 무한 재시도를 끊는다. 큐에 남으면 pendingCount가 영영 0이 되지 않는다.
    expect(await pendingCount()).toBe(0)
    expect(outcome.retrying).toBe(0)
    expect(outcome.rejected).toBe(1)

    // 큐에서 빼되 버리지는 않는다.
    const failures = await db.syncFailures.toArray()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.clientUuid).toBe(UUID_A)
    expect(failures[0]?.reason).toBe('부모 레코드가 아직 서버에 없습니다.')
  })

  it('상한 이전의 CONFLICT는 그대로 큐에 남는다', async () => {
    await queueExpense()
    const [queued] = await takeBatch(1)
    await db.outbox.update(queued!.seq, { tryCount: 8 })

    fetchMock
      .mockResolvedValueOnce(pushOk([{
        clientUuid: UUID_A, table: 'expenses', status: 'CONFLICT',
        reason: '부모 레코드가 아직 서버에 없습니다.',
      }]))
      .mockResolvedValueOnce(pullEmpty())

    const outcome = await syncNow(USER)

    expect(outcome.retrying).toBe(1)
    expect(await pendingCount()).toBe(1)
    expect(await db.syncFailures.count()).toBe(0)
    const [row] = await takeBatch(1)
    expect(row?.tryCount).toBe(9)
  })
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- engine.test.ts`
Expected: `'CONFLICT가 상한을 넘으면 격리하고 큐에서 뺀다'`가 FAIL — `pendingCount()`가 1이고 `syncFailures`가 비어 있다. 두 번째 테스트는 PASS(현재 동작과 같다).

- [ ] **Step 3: 상한 상수를 추가한다**

`apps/web/src/sync/engine.ts`의 `MAX_PUSH_ROUNDS` 선언 바로 아래에 넣는다.

```ts
/**
 * CONFLICT 재시도 상한.
 *
 * 부모가 REJECTED로 격리되면 자식은 영원히 CONFLICT를 반복한다. 큐에서 빠지지
 * 않으므로 `pendingCount`가 0이 되지 않고, 로그아웃 경고가 영구히 뜬다.
 * 사용자에게는 그것을 없앨 방법이 없다.
 *
 * push 주기 기준 수 분에 해당한다 — 일시적인 단절로 부모 전송이 밀리는 경우를
 * 덮기에 충분하고, 영구 실패를 무한정 끌지 않을 만큼 짧다.
 */
const MAX_CONFLICT_TRIES = 10
```

- [ ] **Step 4: CONFLICT 분기를 고친다**

`apps/web/src/sync/engine.ts`의 `pushBatch` 안, `case 'CONFLICT':` 블록을 통째로 바꾼다.

```ts
      case 'CONFLICT':
        // 부모가 아직 없다 — "영구 실패"가 아니라 "아직 이르다"다.
        // 실패로 처리해 큐에서 빼면 이 레코드가 영구 소실된다.
        //
        // 다만 영원히 기다리지는 않는다. 부모가 격리됐다면 이 항목은 다시는
        // 성공하지 못하고 큐에 눌러앉는다. tryCount는 이번 시도 전의 값이다.
        if (row.tryCount + 1 >= MAX_CONFLICT_TRIES) {
          await quarantine(row, result)
          done.push(row.seq)
          rejected += 1
        } else {
          await markRetry(row.seq, result.reason ?? '부모 레코드를 기다리는 중입니다.')
          retrying += 1
        }
        break
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- engine.test.ts`
Expected: PASS (기존 CONFLICT 테스트 포함 전부)

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/sync/engine.ts apps/web/src/sync/engine.test.ts
git commit -m "fix(web): CONFLICT 재시도에 상한을 둔다

부모가 격리되면 자식은 영원히 CONFLICT를 반복하고 큐에서 빠지지 않는다.
pendingCount가 0이 되지 않아 로그아웃 경고가 영구히 뜨고, 사용자에게는
그것을 없앨 방법이 없다. 10회를 넘기면 격리로 보낸다 — 버리지는 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: shared 페이로드 스키마

**Files:**
- Modify: `packages/shared/src/sync.ts`
- Create: `packages/shared/src/sync.test.ts`

**Interfaces:**
- Consumes: `BOOK_STATUS`(`packages/shared/src/codes.ts`), 같은 파일의 `occurredOnSchema`
- Produces:
  - `bookPayloadSchema`, `type BookPayload = { title: string; author: string | null; summary: string | null; status: BookStatus; startedOn: string | null; finishedOn: string | null }`
  - `bookNotePayloadSchema`, `type BookNotePayload = { occurredOn: string; bookClientUuid: string; content: string }`

**이 단계에서 `SYNC_TABLE`은 건드리지 않는다.** 확장은 Task 4에서 소비처와 함께 간다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/sync.test.ts`를 새로 만든다.

```ts
import { describe, expect, it } from 'vitest'
import { bookNotePayloadSchema, bookPayloadSchema } from './sync.ts'

const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', status: 'READING', ...over,
})

describe('bookPayloadSchema', () => {
  it('제목과 상태만으로 통과하고 나머지는 null로 채운다', () => {
    const parsed = bookPayloadSchema.parse(book())
    expect(parsed).toEqual({
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
  })

  it('제목의 앞뒤 공백을 없애고 빈 제목은 거부한다', () => {
    expect(bookPayloadSchema.parse(book({ title: '  사피엔스  ' })).title)
      .toBe('사피엔스')
    expect(bookPayloadSchema.safeParse(book({ title: '   ' })).success).toBe(false)
  })

  it('코드값이 아닌 상태를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ status: 'reading' })).success).toBe(false)
    expect(bookPayloadSchema.safeParse(book({ status: '읽는중' })).success).toBe(false)
  })

  // DB의 books_period_ck를 여기서도 막는다. 통과시키면 INSERT가 DB 에러로
  // 죽고, 그 500은 REJECTED가 아니라 재시도 대상이라 큐가 영영 막힌다.
  it('완독일이 시작일보다 앞서면 거부한다', () => {
    const result = bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-10', finishedOn: '2026-08-09' }),
    )
    expect(result.success).toBe(false)
  })

  it('한쪽이 null이면 기간 검사를 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: null, finishedOn: '2026-08-09' }),
    ).success).toBe(true)
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: null }),
    ).success).toBe(true)
  })

  it('같은 날 시작하고 끝낸 것은 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: '2026-08-09' }),
    ).success).toBe(true)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ userId: 2 })).success).toBe(false)
  })
})

describe('bookNotePayloadSchema', () => {
  const note = (over: Record<string, unknown> = {}) => ({
    occurredOn: '2026-08-11',
    bookClientUuid: '00000000-0000-4000-8000-000000000001',
    content: '3부가 인상 깊다', ...over,
  })

  it('세 필드를 모두 요구한다', () => {
    expect(bookNotePayloadSchema.safeParse(note()).success).toBe(true)
  })

  // 부모는 선택 항목이 아니다. null을 허용하면 서버가 book_id를 못 채우고,
  // NOT NULL 위반이 500으로 나와 큐가 막힌다.
  it('부모 책 UUID가 null이면 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookClientUuid: null })).success)
      .toBe(false)
  })

  it('빈 본문을 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ content: '   ' })).success).toBe(false)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookId: 3 })).success).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter @daily/shared test -- sync.test.ts`
Expected: FAIL — `bookPayloadSchema`를 `./sync.ts`에서 찾을 수 없다.

- [ ] **Step 3: 스키마를 추가한다**

`packages/shared/src/sync.ts`의 import에 `BOOK_STATUS`를 더한다.

```ts
import { BOOK_STATUS, EXPENSE_KIND, OUTBOX_OP, SYNC_RESULT, type SyncResult } from './codes.ts'
```

`expensePayloadSchema` 선언 바로 아래에 넣는다.

```ts
export const bookPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(100).nullable().default(null),
  /** 책 내용·줄거리. 사용자 감상은 book_notes에 쌓인다 */
  summary: z.string().max(2000).nullable().default(null),
  status: z.enum(BOOK_STATUS),
  startedOn: occurredOnSchema.nullable().default(null),
  finishedOn: occurredOnSchema.nullable().default(null),
}).strict().refine(
  (b) => b.finishedOn === null || b.startedOn === null || b.finishedOn >= b.startedOn,
  // DB의 books_period_ck와 같은 규칙이다. 여기서 막지 않으면 위반 입력이
  // INSERT에서 DB 에러로 죽고, 그 500은 REJECTED가 아니라 재시도 대상이라
  // 그 항목이 큐에서 영원히 빠지지 않는다.
  { message: '완독일은 시작일보다 앞설 수 없습니다.', path: ['finishedOn'] },
)
export type BookPayload = z.infer<typeof bookPayloadSchema>

export const bookNotePayloadSchema = z.object({
  occurredOn: occurredOnSchema,
  /**
   * 부모 책. 서버가 (user_id, book_client_uuid)로 book_id를 확정한다.
   * 지출의 카테고리와 달리 선택 항목이 아니다 — book_id가 NOT NULL이다.
   */
  bookClientUuid: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
}).strict()
export type BookNotePayload = z.infer<typeof bookNotePayloadSchema>
```

날짜 문자열 비교가 사전순인 것은 `YYYY-MM-DD`가 고정 폭이라 성립한다. `expenses`의 `occurredOn` 비교와 같은 전제다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter @daily/shared test -- sync.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 빌드를 확인한다**

Run: `pnpm build`
Expected: 성공. `SYNC_TABLE`을 건드리지 않았으므로 api·web은 영향이 없다.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/sync.ts packages/shared/src/sync.test.ts
git commit -m "feat(shared): 책·감상평 페이로드 스키마

books_period_ck와 같은 기간 규칙을 zod refine으로도 막는다. 여기서
통과시키면 CHECK 위반이 DB 에러(500)가 되고, 500은 재시도 대상이라
그 항목이 큐에서 영원히 빠지지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dexie version(3)

**Files:**
- Modify: `apps/web/src/db/index.ts`
- Test: `apps/web/src/db/index.test.ts`

**Interfaces:**
- Consumes: `BookStatus`(`@daily/shared`), 같은 파일의 `LocalRecord`
- Produces:
  - `interface LocalBook extends LocalRecord { title: string; author: string | null; summary: string | null; status: BookStatus; startedOn: string | null; finishedOn: string | null }`
  - `interface LocalBookNote extends LocalRecord { occurredOn: string; bookClientUuid: string; content: string }`
  - `db.books: EntityTable<LocalBook, 'clientUuid'>`, `db.bookNotes: EntityTable<LocalBookNote, 'clientUuid'>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/db/index.test.ts` 끝에 추가한다.

```ts
describe('version 3 — 독서', () => {
  it('책과 감상평 스토어를 연다', async () => {
    await db.open()
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['books', 'bookNotes']),
    )
  })

  it('상태별 조회 인덱스를 갖는다', async () => {
    await db.books.put({
      clientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      userId: 1, serverId: null,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
      updatedAt: '2026-08-11 10:00:00.000', deletedAt: null,
    })
    const rows = await db.books.where('[userId+status]').equals([1, 'READING']).toArray()
    expect(rows).toHaveLength(1)
  })

  it('감상평을 부모 책으로 찾는다', async () => {
    const bookUuid = 'aaaaaaaa-0000-4000-8000-000000000001'
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: 1, serverId: null,
      occurredOn: '2026-08-11', bookClientUuid: bookUuid, content: '좋다',
      updatedAt: '2026-08-11 10:00:00.000', deletedAt: null,
    })
    const rows = await db.bookNotes.where('bookClientUuid').equals(bookUuid).toArray()
    expect(rows).toHaveLength(1)
  })
})
```

import는 이미 파일 맨 위에 있다(`vitest`의 `beforeEach, describe, expect, it`와 `db`). `beforeEach`에 두 줄을 더한다.

```ts
beforeEach(async () => {
  await db.outbox.clear()
  await db.meta.clear()
  await db.books.clear()
  await db.bookNotes.clear()
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- db/index.test.ts`
Expected: FAIL — `db.books`가 undefined다.

- [ ] **Step 3: 로컬 타입을 추가한다**

`apps/web/src/db/index.ts`의 import를 고친다.

```ts
import type { BookStatus, ExpenseKind, OutboxOp, SyncTable } from '@daily/shared'
```

`LocalExpense` 선언 아래에 넣는다.

```ts
export interface LocalBook extends LocalRecord {
  title: string
  author: string | null
  /** 책 내용·줄거리. 사용자 감상은 bookNotes에 쌓인다 */
  summary: string | null
  status: BookStatus
  startedOn: string | null
  finishedOn: string | null
}

export interface LocalBookNote extends LocalRecord {
  occurredOn: string
  /** 부모 책. 로컬 레코드 간 참조는 clientUuid로 한다 */
  bookClientUuid: string
  content: string
}
```

- [ ] **Step 4: 스토어를 추가한다**

`DailyDb` 클래스에 필드를 더한다.

```ts
  books!: EntityTable<LocalBook, 'clientUuid'>
  bookNotes!: EntityTable<LocalBookNote, 'clientUuid'>
```

생성자의 `this.version(2)` 아래에 붙인다.

```ts
    // deletedAt을 인덱스에 넣지 않는 것은 version 2와 같은 이유다 —
    // IndexedDB가 null을 키로 쓰지 못해 살아있는 레코드가 통째로 빠진다.
    this.version(3).stores({
      books: 'clientUuid, userId, [userId+status]',
      bookNotes: 'clientUuid, userId, bookClientUuid, [userId+occurredOn]',
    })
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- db/index.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/db/index.ts apps/web/src/db/index.test.ts
git commit -m "feat(web): 책·감상평 로컬 스토어 (Dexie v3)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 동기화 배선 — `SYNC_TABLE` 확장과 그 소비처

**Files:**
- Modify: `packages/shared/src/sync.ts` (`SYNC_TABLE`, `SCHEMA_VERSION`)
- Modify: `apps/api/src/sync/registry.ts`
- Modify: `apps/api/src/routes/sync.test.ts`
- Modify: `apps/web/src/sync/apply.ts`
- Create: `apps/web/src/sync/apply.test.ts` (이미 있으면 수정)
- Modify: `apps/web/src/sync/engine.ts` (`clearLocalData`)
- Modify: `apps/web/src/sync/engine.test.ts`

**Interfaces:**
- Consumes: Task 2의 `bookPayloadSchema`/`bookNotePayloadSchema`/`BookPayload`/`BookNotePayload`, Task 3의 `db.books`/`db.bookNotes`/`LocalBook`/`LocalBookNote`, 기존 `books`·`bookNotes` drizzle 테이블(`apps/api/src/db/schema.ts`)
- Produces: `SYNC_TABLE`에 `'books'`, `'book_notes'` 추가. `SCHEMA_VERSION = 2`

**이 Task가 큰 이유:** `SYNC_TABLE` 확장은 `SYNC_REGISTRY`(api)와 `APPLIERS`·`recordServerId`(web)를 **동시에** 컴파일 에러로 만든다. 셋 다 `Record<SyncTable, …>`이다. 나눠 커밋하면 중간에 `pnpm build`가 깨진다.

이 Task 안에서 설계 문서의 결함 (a)와 (b)가 함께 해소된다. (a)는 여기서 처음으로 **실제 오동작**이 되고, (b)는 여기서 처음으로 **개인정보 유출**이 된다.

- [ ] **Step 1: 서버 쪽 실패하는 테스트를 쓴다**

`apps/api/src/routes/sync.test.ts`를 고친다. 먼저 import와 헬퍼를 확장한다.

```ts
import { bookNotes, books, expenseCategories, expenses, users } from '../db/schema.ts'
```

`ChangeInput`의 `table` 유니온을 넓힌다.

```ts
interface ChangeInput {
  table: 'expenses' | 'expense_categories' | 'books' | 'book_notes'
  clientUuid: string
  op?: 'UPSERT' | 'DELETE'
  updatedAt: string
  payload?: unknown
}
```

`settle()`에 두 테이블을 더한다. 빠뜨리면 pull 테스트가 정착 지연에 걸려 간헐적으로 실패한다.

```ts
async function settle() {
  const past = '2026-01-01 00:00:00.000'
  await db.update(expenses).set({ syncedAt: past })
  await db.update(expenseCategories).set({ syncedAt: past })
  await db.update(books).set({ syncedAt: past })
  await db.update(bookNotes).set({ syncedAt: past })
}
```

파일 끝에 새 `describe`를 더한다.

```ts
describe('독서 — 부모-자식 동기화', () => {
  const AT = '2026-08-11T12:00:00+09:00'
  const bookPayload = (over: Record<string, unknown> = {}) => ({
    title: '사피엔스', status: 'READING', ...over,
  })
  const notePayload = (bookUuid: string, over: Record<string, unknown> = {}) => ({
    occurredOn: TODAY, bookClientUuid: bookUuid, content: '3부가 인상 깊다', ...over,
  })

  it('같은 배치에서 책이 먼저 오면 감상평의 book_id가 채워진다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    expect(body.results.map((r) => r.status)).toEqual(['APPLIED', 'APPLIED'])

    const [book] = await db.select().from(books)
    const [note] = await db.select().from(bookNotes)
    expect(note?.bookId).toBe(book?.id)
    expect(note?.bookClientUuid).toBe(UUID(1))
  })

  it('부모 책이 아직 없으면 REJECTED가 아니라 CONFLICT다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // REJECTED로 만들면 클라이언트가 큐에서 빼버려 감상평이 영구 소실된다.
    expect(body.results[0]?.status).toBe('CONFLICT')
    expect(await db.select().from(bookNotes)).toHaveLength(0)
  })

  it('부모를 보낸 뒤 재시도하면 저장된다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])
    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    expect(body.results[0]?.status).toBe('APPLIED')
    expect(await db.select().from(bookNotes)).toHaveLength(1)
  })

  it('남의 책을 부모로 지정하면 CONFLICT다', async () => {
    const mine = await tokenFor(await makeUser('a@example.com'))
    const theirs = await tokenFor(await makeUser('bbbb@example.com'))
    await push(theirs, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])

    const { body } = await push(mine, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // 소유권 격리. 남의 책 id가 내 감상평에 박히면 안 된다.
    expect(body.results[0]?.status).toBe('CONFLICT')
    expect(await db.select().from(bookNotes)).toHaveLength(0)
  })

  it('삭제된 책도 부모로 찾는다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
    ])
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), op: 'DELETE', updatedAt: '2026-08-11T13:00:00+09:00' },
    ])

    const { body } = await push(auth, [
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])

    // 툼스톤을 제외하면 이 감상평은 영원히 CONFLICT가 되어 큐가 막힌다.
    expect(body.results[0]?.status).toBe('APPLIED')
  })

  it('기간이 뒤집힌 책은 REJECTED다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    const { body } = await push(auth, [{
      table: 'books', clientUuid: UUID(1), updatedAt: AT,
      payload: bookPayload({ startedOn: '2026-08-10', finishedOn: '2026-08-09' }),
    }])

    // zod에서 걸려야 한다. DB CHECK까지 가면 500이고, 500은 재시도 대상이다.
    expect(body.results[0]?.status).toBe('REJECTED')
  })

  it('pull로 책과 감상평이 내려온다', async () => {
    const auth = await tokenFor(await makeUser('a@example.com'))
    await push(auth, [
      { table: 'books', clientUuid: UUID(1), updatedAt: AT, payload: bookPayload() },
      { table: 'book_notes', clientUuid: UUID(2), updatedAt: AT, payload: notePayload(UUID(1)) },
    ])
    await settle()

    const { body } = await pull(auth)
    const tables = body.changes.map((c) => c.table)
    expect(tables).toContain('books')
    expect(tables).toContain('book_notes')

    const note = body.changes.find((c) => c.table === 'book_notes')
    expect(note?.occurredOn).toBe(TODAY)
    expect(note?.payload.bookClientUuid).toBe(UUID(1))
    // 서버 내부 id는 페이로드에 실리지 않는다.
    expect(note?.payload.bookId).toBeUndefined()

    const book = body.changes.find((c) => c.table === 'books')
    expect(book?.occurredOn).toBeNull()
    expect(book?.payload.title).toBe('사피엔스')
  })
})
```

- [ ] **Step 2: 웹 쪽 실패하는 테스트를 쓴다**

`apps/web/src/sync/apply.test.ts`를 만든다(이미 있으면 아래 케이스를 더한다).

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncRow } from '@daily/shared'
import { db } from '../db/index.ts'
import { applyServerRows, recordServerId } from './apply.ts'

const USER = 1
const BOOK_UUID = 'aaaaaaaa-0000-4000-8000-000000000001'
const NOTE_UUID = 'bbbbbbbb-0000-4000-8000-000000000002'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

const bookRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'books', id: 10, clientUuid: BOOK_UUID, occurredOn: null,
  updatedAt: '2026-08-11 12:00:00.000', syncedAt: '2026-08-11 12:00:00.500',
  deletedAt: null,
  payload: {
    title: '사피엔스', author: '유발 하라리', summary: null,
    status: 'READING', startedOn: null, finishedOn: null,
  },
  ...over,
})

const noteRow = (over: Partial<SyncRow> = {}): SyncRow => ({
  table: 'book_notes', id: 20, clientUuid: NOTE_UUID, occurredOn: '2026-08-11',
  updatedAt: '2026-08-11 12:00:00.000', syncedAt: '2026-08-11 12:00:00.500',
  deletedAt: null,
  payload: { occurredOn: '2026-08-11', bookClientUuid: BOOK_UUID, content: '좋다' },
  ...over,
})

describe('applyServerRows — 독서', () => {
  it('서버에서 내려온 책을 로컬에 넣는다', async () => {
    await applyServerRows(USER, [bookRow()])

    const local = await db.books.get(BOOK_UUID)
    expect(local?.title).toBe('사피엔스')
    expect(local?.author).toBe('유발 하라리')
    expect(local?.status).toBe('READING')
    expect(local?.serverId).toBe(10)
    expect(local?.userId).toBe(USER)
  })

  it('서버에서 내려온 감상평을 로컬에 넣는다', async () => {
    await applyServerRows(USER, [noteRow()])

    const local = await db.bookNotes.get(NOTE_UUID)
    expect(local?.content).toBe('좋다')
    expect(local?.bookClientUuid).toBe(BOOK_UUID)
    expect(local?.occurredOn).toBe('2026-08-11')
  })

  it('로컬이 더 최신이면 덮지 않고 serverId만 채운다', async () => {
    await db.books.put({
      clientUuid: BOOK_UUID, userId: USER, serverId: null,
      title: '내가 고친 제목', author: null, summary: null,
      status: 'DONE', startedOn: null, finishedOn: null,
      updatedAt: '2026-08-11 13:00:00.000', deletedAt: null,
    })

    await applyServerRows(USER, [bookRow()])

    const local = await db.books.get(BOOK_UUID)
    expect(local?.title).toBe('내가 고친 제목')
    expect(local?.serverId).toBe(10)
  })
})

describe('recordServerId', () => {
  // 삼항 분기로 두면 books가 else로 떨어져 expenseCategories에 기록된다.
  // 책의 serverId가 null로 남고, serverId가 없으면 삭제가 툼스톤으로
  // 전파되지 않아 지운 책이 다른 기기에서 되살아난다.
  it('책의 serverId를 책 스토어에 기록한다', async () => {
    await db.books.put({
      clientUuid: BOOK_UUID, userId: USER, serverId: null,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    await recordServerId('books', BOOK_UUID, 42)

    expect((await db.books.get(BOOK_UUID))?.serverId).toBe(42)
    expect(await db.expenseCategories.count()).toBe(0)
  })

  it('감상평의 serverId를 감상평 스토어에 기록한다', async () => {
    await db.bookNotes.put({
      clientUuid: NOTE_UUID, userId: USER, serverId: null,
      occurredOn: '2026-08-11', bookClientUuid: BOOK_UUID, content: '좋다',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    await recordServerId('book_notes', NOTE_UUID, 43)

    expect((await db.bookNotes.get(NOTE_UUID))?.serverId).toBe(43)
  })
})
```

`apps/web/src/sync/engine.test.ts`에는 `clearLocalData` 테스트를 더한다. 파일에 `clearLocalData` import를 추가한다.

```ts
describe('clearLocalData', () => {
  // 목록을 손으로 관리하면 새 테이블을 빠뜨리고, 그 누락은 "로그아웃해도
  // 남의 독서 기록이 기기에 남는다"는 형태로만 드러난다.
  it('모든 로컬 스토어를 비운다', async () => {
    await db.books.put({
      clientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      userId: USER, serverId: 1,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: USER, serverId: 2,
      occurredOn: '2026-08-11', content: '좋다',
      bookClientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })
    await queueExpense()

    await clearLocalData()

    for (const table of db.tables) {
      expect(await table.count(), `${table.name}이 비지 않았다`).toBe(0)
    }
  })
})
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter api test -- sync.test.ts` 그리고 `pnpm --filter web test -- apply.test.ts engine.test.ts`
Expected: 둘 다 FAIL. api는 `'books'`가 `SYNC_TABLE`에 없어 400/타입 에러, web은 `recordServerId('books', …)`가 타입 에러이거나 잘못된 스토어에 쓴다.

- [ ] **Step 4: `SYNC_TABLE`과 `SCHEMA_VERSION`을 고친다**

`packages/shared/src/sync.ts`

```ts
/**
 * push/pull 페이로드의 스키마 버전.
 *
 * PWA는 사용자가 캐시된 구버전을 오래 유지한다. 서버가 더 낮은 버전을 받으면
 * 426으로 막고 Service Worker 갱신을 유도한다. 이 방어가 없으면 구버전이
 * 잘못된 모양의 데이터를 계속 밀어 넣는다.
 *
 * **레코드 모양을 바꾸거나 테이블을 더하면 이 값을 올린다.** 구버전은 모르는
 * 테이블의 행을 받으면 `APPLIERS[row.table]`이 undefined라 동기화 루프가
 * 통째로 죽는다. 사용자에게는 "기록이 안 올라감"으로만 보인다.
 */
export const SCHEMA_VERSION = 2

/** 동기화 대상 테이블. 서버 테이블명과 정확히 같다. */
export const SYNC_TABLE = [
  'expense_categories', 'expenses', 'books', 'book_notes',
] as const
```

- [ ] **Step 5: 서버 레지스트리에 두 항목을 더한다**

`apps/api/src/sync/registry.ts`의 import를 고친다.

```ts
import {
  bookNotePayloadSchema, bookPayloadSchema,
  expenseCategoryPayloadSchema, expensePayloadSchema,
  type BookNotePayload, type BookPayload,
  type ExpenseCategoryPayload, type ExpensePayload, type SyncTable,
} from '@daily/shared'
import { bookNotes, books, expenseCategories, expenses } from '../db/schema.ts'
```

`SYNC_REGISTRY`의 `expenses` 항목 뒤에 붙인다.

```ts
  books: define<BookPayload>({
    table: books,
    payload: bookPayloadSchema,
    hasOccurredOn: false,
    toColumns: (p: BookPayload) => ({
      title: p.title,
      author: p.author,
      summary: p.summary,
      status: p.status,
      startedOn: p.startedOn,
      finishedOn: p.finishedOn,
    }),
    toPayload: (r) => ({
      title: r.title,
      author: r.author,
      summary: r.summary,
      status: r.status,
      startedOn: r.startedOn,
      finishedOn: r.finishedOn,
    }),
  }),
  book_notes: define<BookNotePayload>({
    table: bookNotes,
    payload: bookNotePayloadSchema,
    hasOccurredOn: true,
    parent: {
      uuidField: 'bookClientUuid',
      parentTable: books,
      // 감상평은 부모 없이 존재할 수 없다. book_id가 NOT NULL이다.
      required: true,
    },
    toColumns: (p: BookNotePayload, parentId) => {
      // required: true라 resolveParentId가 null을 돌려주지 않는다. 도달할 수
      // 없지만 non-null 단언 대신 명시적으로 막는다 — null이 새어 들어가면
      // NOT NULL 위반이 500이 되고, 500은 재시도 대상이라 큐가 막힌다.
      if (parentId === null) {
        throw new Error('book_notes에 부모 책이 지정되지 않았습니다.')
      }
      return {
        occurredOn: p.occurredOn,
        bookId: parentId,
        bookClientUuid: p.bookClientUuid,
        content: p.content,
      }
    },
    // bookId는 내보내지 않는다. 서버 내부 식별자가 클라이언트로 새면
    // 다음 push에서 그 값이 되돌아올 경로가 생긴다.
    toPayload: (r) => ({
      occurredOn: r.occurredOn,
      bookClientUuid: r.bookClientUuid,
      content: r.content,
    }),
  }),
```

- [ ] **Step 6: 서버 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter api test -- sync.test.ts`
Expected: PASS

- [ ] **Step 7: 웹 `APPLIERS`와 `recordServerId`를 고친다**

`apps/web/src/sync/apply.ts`의 import를 고친다.

```ts
import type { BookStatus, ExpenseKind, SyncRow, SyncTable } from '@daily/shared'
```

`APPLIERS`에 두 항목을 더한다.

```ts
  books: (userId, row) => applyToTable(db.books, userId, row, (r) => ({
    clientUuid: r.clientUuid,
    userId,
    serverId: r.id,
    title: String(r.payload.title),
    author: (r.payload.author as string | null) ?? null,
    summary: (r.payload.summary as string | null) ?? null,
    status: r.payload.status as BookStatus,
    startedOn: (r.payload.startedOn as string | null) ?? null,
    finishedOn: (r.payload.finishedOn as string | null) ?? null,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  })),

  book_notes: (userId, row) => applyToTable(db.bookNotes, userId, row, (r) => ({
    clientUuid: r.clientUuid,
    userId,
    serverId: r.id,
    occurredOn: String(r.payload.occurredOn),
    bookClientUuid: String(r.payload.bookClientUuid),
    content: String(r.payload.content),
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  })),
```

`recordServerId`를 통째로 바꾼다.

```ts
/**
 * 테이블명 → 로컬 스토어.
 *
 * 삼항 분기로 두면 새 테이블이 else로 떨어져 **엉뚱한 스토어에** 기록된다.
 * 대상 레코드의 `serverId`는 null로 남고, `serverId`가 없으면 삭제가 툼스톤으로
 * 전파되지 않아 지운 레코드가 다른 기기에서 되살아난다.
 *
 * `Record<SyncTable, …>`이라 `SYNC_TABLE`에 항목을 더하면 여기가 컴파일
 * 에러로 따라온다.
 */
const SERVER_ID_STORES: Record<SyncTable, {
  update(key: string, changes: { serverId: number }): Promise<unknown>
}> = {
  expenses: db.expenses,
  expense_categories: db.expenseCategories,
  books: db.books,
  book_notes: db.bookNotes,
}

/** push 응답의 서버 id를 로컬 레코드에 기록한다. */
export async function recordServerId(
  table: SyncTable,
  clientUuid: string,
  serverId: number,
): Promise<void> {
  await SERVER_ID_STORES[table].update(clientUuid, { serverId })
}
```

- [ ] **Step 8: `clearLocalData`를 순회로 바꾼다**

`apps/web/src/sync/engine.ts`

```ts
/**
 * 로컬 데이터를 전부 비운다. 로그아웃 시 호출한다.
 *
 * 개인 기록이 기기에 남으면 다음 사용자가 그대로 본다. 큐에 남은 변경도 함께
 * 사라지므로, 로그아웃 전에 동기화를 끝내는 것은 호출부 책임이다.
 *
 * 테이블을 이름으로 나열하지 않는다. 손으로 관리하면 새 스토어를 추가할 때
 * 빠뜨리고, 그 누락은 "로그아웃해도 남의 기록이 남는다"는 형태로만 드러난다.
 */
export async function clearLocalData(): Promise<void> {
  resetSyncState()
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}
```

- [ ] **Step 9: 웹 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test`
Expected: PASS

- [ ] **Step 10: 전체 검증**

Run: `pnpm build && pnpm test`
Expected: 둘 다 성공

- [ ] **Step 11: 커밋**

```bash
git add packages/shared/src/sync.ts apps/api/src/sync/registry.ts \
        apps/api/src/routes/sync.test.ts apps/web/src/sync/apply.ts \
        apps/web/src/sync/apply.test.ts apps/web/src/sync/engine.ts \
        apps/web/src/sync/engine.test.ts
git commit -m "feat: 책·감상평 동기화 배선

SYNC_TABLE 확장은 SYNC_REGISTRY(api)와 APPLIERS(web)를 동시에 컴파일
에러로 만들어 쪼갤 수 없다. 같은 커밋에서 두 결함도 함께 해소된다.

- recordServerId의 삼항 분기 → Record<SyncTable, …> 맵.
  삼항으로 두면 책의 serverId가 expenseCategories에 기록되고, serverId가
  없으면 삭제가 전파되지 않아 지운 책이 다른 기기에서 되살아난다.
- clearLocalData의 하드코딩된 목록 → db.tables 순회.
  빠뜨리면 로그아웃해도 독서 기록이 기기에 남아 다음 사용자가 본다.

SCHEMA_VERSION을 2로 올린다. 구버전 PWA는 books를 몰라 pull에서
APPLIERS[row.table]이 undefined가 되고 동기화 루프가 통째로 죽는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `pages/book/repository.ts`

**Files:**
- Create: `apps/web/src/pages/book/repository.ts`
- Create: `apps/web/src/pages/book/repository.test.ts`

**Interfaces:**
- Consumes: `db`/`LocalBook`/`LocalBookNote`(`../../db/index.ts`), `enqueue`/`localNow`(`../../sync/outbox.ts`), `BookStatus`(`@daily/shared`)
- Produces:
  - `interface BookInput { title: string; author: string | null; summary: string | null; status: BookStatus; startedOn: string | null; finishedOn: string | null }`
  - `interface BookNoteInput { occurredOn: string; bookClientUuid: string; content: string }`
  - `listBooks(userId: number, status: BookStatus | 'ALL'): Promise<LocalBook[]>`
  - `getBook(userId: number, clientUuid: string): Promise<LocalBook | undefined>`
  - `listNotesByBook(userId: number, bookClientUuid: string): Promise<LocalBookNote[]>`
  - `countNotesByBook(userId: number): Promise<Map<string, number>>`
  - `saveBook(userId: number, input: BookInput, clientUuid?: string): Promise<string>`
  - `deleteBook(userId: number, clientUuid: string): Promise<void>`
  - `saveNote(userId: number, input: BookNoteInput, clientUuid?: string): Promise<string>`
  - `deleteNote(userId: number, clientUuid: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/book/repository.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { takeBatch } from '../../sync/outbox.ts'
import {
  countNotesByBook, deleteBook, deleteNote, getBook, listBooks, listNotesByBook,
  saveBook, saveNote,
} from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-11'

const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', author: null, summary: null,
  status: 'READING' as const, startedOn: null, finishedOn: null, ...over,
})

beforeEach(async () => {
  await db.books.clear()
  await db.bookNotes.clear()
  await db.outbox.clear()
})

describe('책 저장', () => {
  it('로컬에 저장하고 같은 동작으로 큐에 넣는다', async () => {
    const uuid = await saveBook(USER, book())

    expect(await listBooks(USER, 'ALL')).toHaveLength(1)
    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.table).toBe('books')
    expect(queue[0]?.clientUuid).toBe(uuid)
  })

  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveBook(USER, book())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort())
      .toEqual(['author', 'finishedOn', 'startedOn', 'status', 'summary', 'title'])
  })

  it('같은 clientUuid로 다시 저장하면 수정이다', async () => {
    const uuid = await saveBook(USER, book({ status: 'READING' }))
    await saveBook(USER, book({ status: 'DONE' }), uuid)

    expect((await getBook(USER, uuid))?.status).toBe('DONE')
    expect(await takeBatch(10)).toHaveLength(1)
  })

  it('다른 사용자의 책은 보이지 않는다', async () => {
    await saveBook(USER, book())
    await saveBook(OTHER, book())
    expect(await listBooks(USER, 'ALL')).toHaveLength(1)
  })

  it('상태로 거른다', async () => {
    await saveBook(USER, book({ status: 'READING' }))
    await saveBook(USER, book({ status: 'DONE' }))

    expect(await listBooks(USER, 'READING')).toHaveLength(1)
    expect(await listBooks(USER, 'ALL')).toHaveLength(2)
  })
})

describe('책 삭제', () => {
  it('물리 삭제하지 않고 툼스톤을 남긴다', async () => {
    const uuid = await saveBook(USER, book())
    await db.books.update(uuid, { serverId: 7 })
    await deleteBook(USER, uuid)

    expect(await listBooks(USER, 'ALL')).toHaveLength(0)
    expect((await db.books.get(uuid))?.deletedAt).not.toBeNull()
    const [row] = await takeBatch(1)
    expect(row?.op).toBe('DELETE')
  })

  it('남의 책은 지우지 않는다', async () => {
    const uuid = await saveBook(OTHER, book())
    await deleteBook(USER, uuid)
    expect((await db.books.get(uuid))?.deletedAt).toBeNull()
  })

  // 캐스케이드 소프트 삭제를 하면 감상평 N건이 한꺼번에 큐에 쌓이고,
  // 되살릴 때 어떤 감상평이 그 삭제로 지워졌는지 구분할 수 없다.
  it('감상평은 함께 지우지 않는다', async () => {
    const bookUuid = await saveBook(USER, book())
    const noteUuid = await saveNote(USER, {
      occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다',
    })

    await deleteBook(USER, bookUuid)

    expect((await db.bookNotes.get(noteUuid))?.deletedAt).toBeNull()
  })
})

describe('감상평', () => {
  it('책보다 뒤 seq를 받아 부모가 먼저 전송된다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다' })

    const queue = await takeBatch(10)
    expect(queue.map((r) => r.table)).toEqual(['books', 'book_notes'])
  })

  // enqueue의 compaction이 가장 오래된 seq를 유지하는 것에 기대는 동작이다.
  // 새 seq를 받으면 자식이 부모보다 먼저 나가 서버가 CONFLICT를 반복한다.
  it('책을 수정해도 여전히 감상평보다 앞선다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다' })
    await saveBook(USER, book({ title: '사피엔스(개정판)' }), bookUuid)

    const queue = await takeBatch(10)
    expect(queue.map((r) => r.table)).toEqual(['books', 'book_notes'])
  })

  it('부모 책으로 감상평을 찾고 최근 날짜가 앞에 온다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: '2026-08-09', bookClientUuid: bookUuid, content: '앞' })
    await saveNote(USER, { occurredOn: '2026-08-11', bookClientUuid: bookUuid, content: '뒤' })

    const notes = await listNotesByBook(USER, bookUuid)
    expect(notes.map((n) => n.content)).toEqual(['뒤', '앞'])
  })

  it('책별 감상평 수를 센다', async () => {
    const a = await saveBook(USER, book({ title: 'A' }))
    const b = await saveBook(USER, book({ title: 'B' }))
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: a, content: '1' })
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: a, content: '2' })

    const counts = await countNotesByBook(USER)
    expect(counts.get(a)).toBe(2)
    expect(counts.get(b)).toBeUndefined()
  })

  it('삭제한 감상평은 세지 않는다', async () => {
    const bookUuid = await saveBook(USER, book())
    const noteUuid = await saveNote(USER, {
      occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다',
    })
    await deleteNote(USER, noteUuid)

    expect(await listNotesByBook(USER, bookUuid)).toHaveLength(0)
    expect((await countNotesByBook(USER)).get(bookUuid)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/repository.test.ts`
Expected: FAIL — `./repository.ts`가 없다.

- [ ] **Step 3: 저장소를 구현한다**

`apps/web/src/pages/book/repository.ts`

```ts
import type { BookStatus } from '@daily/shared'
import { db, type LocalBook, type LocalBookNote } from '../../db/index.ts'
import { enqueue, localNow } from '../../sync/outbox.ts'

/**
 * 화면이 독서 데이터에 닿는 유일한 통로.
 *
 * 읽기·쓰기 모두 로컬 Dexie를 거친다. 화면 컴포넌트는 API를 직접 호출하지
 * 않는다 — 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너진다.
 */

export interface BookInput {
  title: string
  author: string | null
  summary: string | null
  status: BookStatus
  startedOn: string | null
  finishedOn: string | null
}

export interface BookNoteInput {
  occurredOn: string
  bookClientUuid: string
  content: string
}

function newUuid(): string {
  return crypto.randomUUID()
}

/** 살아있는 레코드만 남긴다. deletedAt은 인덱스에 없으므로 여기서 거른다. */
function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export async function listBooks(
  userId: number,
  status: BookStatus | 'ALL',
): Promise<LocalBook[]> {
  const rows = status === 'ALL'
    ? await db.books.where('userId').equals(userId).toArray()
    : await db.books.where('[userId+status]').equals([userId, status]).toArray()
  // 최근에 손댄 책이 위로 온다.
  return live(rows).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getBook(
  userId: number,
  clientUuid: string,
): Promise<LocalBook | undefined> {
  const row = await db.books.get(clientUuid)
  if (!row || row.userId !== userId || row.deletedAt !== null) return undefined
  return row
}

export async function listNotesByBook(
  userId: number,
  bookClientUuid: string,
): Promise<LocalBookNote[]> {
  const rows = await db.bookNotes.where('bookClientUuid').equals(bookClientUuid).toArray()
  return live(rows.filter((row) => row.userId === userId))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
}

/** 목록 화면의 "감상평 N" 배지용. 책 UUID → 개수 */
export async function countNotesByBook(userId: number): Promise<Map<string, number>> {
  const rows = live(await db.bookNotes.where('userId').equals(userId).toArray())
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.bookClientUuid, (counts.get(row.bookClientUuid) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 책을 저장하고 같은 트랜잭션에서 큐에 넣는다.
 *
 * 레코드만 쓰고 큐 적재가 실패하면 그 변경은 이 기기에만 남아 영영 서버로
 * 가지 않는다. 사용자는 다른 기기에서 기록이 비어 있는 것을 나중에 발견한다.
 */
export async function saveBook(
  userId: number,
  input: BookInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.books, db.outbox, async () => {
    const existing = await db.books.get(clientUuid)
    await db.books.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      title: input.title,
      author: input.author,
      summary: input.summary,
      status: input.status,
      startedOn: input.startedOn,
      finishedOn: input.finishedOn,
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'books',
      clientUuid,
      op: 'UPSERT',
      payload: {
        title: input.title,
        author: input.author,
        summary: input.summary,
        status: input.status,
        startedOn: input.startedOn,
        finishedOn: input.finishedOn,
      },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

/**
 * 책에 툼스톤을 남긴다.
 *
 * **감상평은 건드리지 않는다.** 캐스케이드 소프트 삭제를 하면 감상평 N건이
 * 한꺼번에 큐에 쌓이고, 되살릴 때 어떤 감상평이 그 삭제로 지워진 것인지
 * 구분할 수 없다. 삭제된 책은 목록에 뜨지 않으므로 감상평으로 가는 경로도 없다.
 */
export async function deleteBook(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.books, db.outbox, async () => {
    const existing = await db.books.get(clientUuid)
    if (!existing || existing.userId !== userId) return

    await db.books.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'books',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}

export async function saveNote(
  userId: number,
  input: BookNoteInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.bookNotes, db.outbox, async () => {
    const existing = await db.bookNotes.get(clientUuid)
    await db.bookNotes.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      occurredOn: input.occurredOn,
      bookClientUuid: input.bookClientUuid,
      content: input.content,
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'book_notes',
      clientUuid,
      op: 'UPSERT',
      payload: {
        occurredOn: input.occurredOn,
        bookClientUuid: input.bookClientUuid,
        content: input.content,
      },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteNote(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.bookNotes, db.outbox, async () => {
    const existing = await db.bookNotes.get(clientUuid)
    if (!existing || existing.userId !== userId) return

    await db.bookNotes.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'book_notes',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/repository.test.ts`
Expected: PASS

`'책을 수정해도 여전히 감상평보다 앞선다'`가 실패하면 `enqueue`의 seq 유지가 깨진 것이다. `repository.ts`를 고치지 말고 `apps/web/src/sync/outbox.ts`의 compaction을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/book/repository.ts apps/web/src/pages/book/repository.test.ts
git commit -m "feat(web): 독서 저장소

책 삭제 시 감상평은 건드리지 않는다. 캐스케이드 소프트 삭제를 하면
감상평 N건이 한꺼번에 큐에 쌓이고, 되살릴 때 어떤 감상평이 그 삭제로
지워진 것인지 구분할 수 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 탭바와 라우팅

**Files:**
- Create: `apps/web/src/components/TabBar.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `NavLink`(`react-router`)
- Produces: `<TabBar />` — props 없음. `/`와 `/books` 두 항목

화면이 아직 없으므로 이 Task에서는 `/books`에 자리표시 컴포넌트를 두지 않는다. **Task 7을 이 Task와 이어서 진행한다** — 라우트만 있고 화면이 없으면 `/books`가 빈 페이지가 된다.

- [ ] **Step 1: TabBar를 만든다**

`apps/web/src/components/TabBar.tsx`

```tsx
import { NavLink } from 'react-router'

/**
 * 하단 탭 내비게이션.
 *
 * 일기·식사·운동이 붙으면 이 배열에 한 줄씩 더한다. 화면 스택 안쪽
 * (책 상세 등)에서는 이 컴포넌트를 렌더링하지 않는다 — 다른 탭으로 바로
 * 나가면 돌아올 자리를 잃는다.
 */
const TABS = [
  { to: '/', label: '지출' },
  { to: '/books', label: '독서' },
] as const

export default function TabBar() {
  return (
    <nav
      aria-label="주요 화면"
      className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md border-t border-gray-200 bg-white"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `flex-1 py-3 text-center text-sm ${
              isActive ? 'font-semibold text-gray-900' : 'text-gray-500'
            }`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: 라우트를 더한다**

`apps/web/src/App.tsx`의 import에 추가한다.

```tsx
import TabBar from './components/TabBar.tsx'
import BookDetailPage from './pages/book/BookDetailPage.tsx'
import BookListPage from './pages/book/BookListPage.tsx'
```

인증된 분기를 바꾼다.

```tsx
        {status === 'AUTHENTICATED' ? (
          <>
            <Route path="/" element={<><ExpensePage /><TabBar /></>} />
            <Route path="/books" element={<><BookListPage /><TabBar /></>} />
            {/* 상세는 목록 안쪽 화면이다. 탭바를 두면 돌아올 자리를 잃는다 */}
            <Route path="/books/:clientUuid" element={<BookDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
```

탭바가 화면 하단을 덮으므로 `ExpensePage`·`BookListPage`의 최상위 `<main>`에 `pb-20`을 더한다. `ExpensePage`의 경우 `className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4"`를 `"… p-4 pb-20"`으로 바꾼다.

- [ ] **Step 3: Task 7·8을 먼저 끝낸다**

`BookListPage`와 `BookDetailPage`가 없으면 이 Step에서 빌드가 깨진다. **Task 7과 Task 8을 완료한 뒤 이 Task의 Step 4로 돌아온다.** 순서상 TabBar 파일은 먼저 만들어 두는 것이 편하므로 Step 1만 지금 하고, Step 2는 Task 8이 끝난 뒤에 적용한다.

- [ ] **Step 4: 확인하고 커밋한다** (Task 8 완료 후)

Run: `pnpm --filter web test && pnpm build`
Expected: PASS

```bash
git add apps/web/src/components/TabBar.tsx apps/web/src/App.tsx apps/web/src/pages/expense/ExpensePage.tsx
git commit -m "feat(web): 하단 탭바와 독서 라우트

화면 간 이동 수단이 처음 필요해졌다. 책 상세는 목록 안쪽 화면이므로
탭바를 감춘다 — 다른 탭으로 바로 나가면 돌아올 자리를 잃는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 책 목록과 등록 폼

**Files:**
- Create: `apps/web/src/pages/book/BookForm.tsx`
- Create: `apps/web/src/pages/book/BookListPage.tsx`
- Create: `apps/web/src/pages/book/BookListPage.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `listBooks`/`countNotesByBook`/`saveBook`/`BookInput`, `useSession`/`useSync`, `kstDate`(`@daily/shared`)
- Produces:
  - `<BookForm initial?: LocalBook, onSubmit: (input: BookInput) => Promise<void>, onCancel?: () => void />`
  - `<BookListPage />` — props 없음
  - `STATUS_LABEL: Record<BookStatus, string>` (`BookForm.tsx`에서 export, `BookDetailPage`도 쓴다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/book/BookListPage.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookListPage from './BookListPage.tsx'
import { saveBook } from './repository.ts'

// 세션·동기화 스토어 세팅은 ExpensePage.test.tsx와 같은 모양이다.
// useSync를 세팅하지 않으면 syncSoon이 진짜 엔진을 불러 fetch를 때린다.
const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.books.clear()
  await db.bookNotes.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

const renderPage = () =>
  render(<MemoryRouter><BookListPage /></MemoryRouter>)

describe('책 목록', () => {
  it('기록이 없으면 안내를 보여준다', async () => {
    renderPage()
    expect(await screen.findByText('등록한 책이 없습니다.')).toBeInTheDocument()
  })

  it('책과 감상평 수를 보여준다', async () => {
    const uuid = await saveBook(USER.id, {
      title: '사피엔스', author: '유발 하라리', summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: USER.id, serverId: null, occurredOn: '2026-08-11',
      bookClientUuid: uuid, content: '좋다',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    renderPage()

    expect(await screen.findByText('사피엔스')).toBeInTheDocument()
    expect(await screen.findByText('유발 하라리')).toBeInTheDocument()
    expect(await screen.findByText('감상평 1')).toBeInTheDocument()
  })

  it('상태 탭으로 거른다', async () => {
    await saveBook(USER.id, {
      title: '읽는 책', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
    await saveBook(USER.id, {
      title: '완독한 책', author: null, summary: null,
      status: 'DONE', startedOn: null, finishedOn: '2026-08-10',
    })

    renderPage()
    await screen.findByText('읽는 책')

    await userEvent.click(screen.getByRole('button', { name: '완독' }))

    await waitFor(() => {
      expect(screen.queryByText('읽는 책')).not.toBeInTheDocument()
    })
    expect(screen.getByText('완독한 책')).toBeInTheDocument()
  })

  it('책을 등록하면 목록에 나타난다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('클린 코드')).toBeInTheDocument()
  })

  it('상태를 읽는 중으로 두면 시작일이 오늘로 채워진다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.click(screen.getByRole('button', { name: '읽는 중' }))

    const started = screen.getByLabelText('시작일') as HTMLInputElement
    expect(started.value).not.toBe('')
  })
})
```

`useSession.setState`의 `user` 모양은 `apps/web/src/store/session.ts`의 실제 타입에 맞춘다. 기존 `ExpensePage.test.tsx`가 세션을 세팅하는 방식이 있으면 그것을 그대로 따른다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/BookListPage.test.tsx`
Expected: FAIL — `./BookListPage.tsx`가 없다.

- [ ] **Step 3: `BookForm`을 만든다**

`apps/web/src/pages/book/BookForm.tsx`

```tsx
import { useState, type FormEvent } from 'react'
import { kstDate, type BookStatus } from '@daily/shared'
import type { LocalBook } from '../../db/index.ts'
import type { BookInput } from './repository.ts'

/** 화면에 보이는 한글 라벨은 코드값과 분리한다. DB에는 코드값만 들어간다. */
export const STATUS_LABEL: Record<BookStatus, string> = {
  WISHLIST: '읽고 싶음',
  READING: '읽는 중',
  DONE: '완독',
}

const STATUSES: BookStatus[] = ['WISHLIST', 'READING', 'DONE']

interface Props {
  initial?: LocalBook
  onSubmit: (input: BookInput) => Promise<void>
  onCancel?: () => void
}

export default function BookForm({ initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [status, setStatus] = useState<BookStatus>(initial?.status ?? 'WISHLIST')
  const [startedOn, setStartedOn] = useState(initial?.startedOn ?? '')
  const [finishedOn, setFinishedOn] = useState(initial?.finishedOn ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /**
   * 상태를 고르면 짝이 되는 날짜를 오늘로 채운다.
   *
   * **이미 값이 있으면 덮지 않는다.** 과거에 읽은 책을 등록하면서 상태를
   * 바꿀 때 사용자가 입력한 날짜를 지우면 안 된다.
   */
  function pickStatus(next: BookStatus) {
    setStatus(next)
    const today = kstDate(new Date())
    if (next === 'READING' && startedOn === '') setStartedOn(today)
    if (next === 'DONE' && finishedOn === '') setFinishedOn(today)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '') {
      setError('제목을 입력해 주세요.')
      return
    }
    // DB의 books_period_ck와 shared의 refine이 같은 규칙을 갖는다. 여기서
    // 먼저 잡아 사용자가 그 자리에서 고칠 수 있게 한다.
    if (startedOn !== '' && finishedOn !== '' && finishedOn < startedOn) {
      setError('완독일은 시작일보다 앞설 수 없습니다.')
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({
        title: trimmed,
        author: author.trim() || null,
        summary: summary.trim() || null,
        status,
        startedOn: startedOn || null,
        finishedOn: finishedOn || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4"
    >
      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pickStatus(s)}
            aria-pressed={status === s}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              status === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">제목</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">저자</span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={100}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">책 소개</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={2000}
          rows={3}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">시작일</span>
          <input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">완독일</span>
          <input
            type="date"
            value={finishedOn}
            onChange={(e) => setFinishedOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: `BookListPage`를 만든다**

`apps/web/src/pages/book/BookListPage.tsx`

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import type { BookStatus } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookForm, { STATUS_LABEL } from './BookForm.tsx'
import { countNotesByBook, listBooks, saveBook, type BookInput } from './repository.ts'

type Filter = BookStatus | 'ALL'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'READING', label: '읽는 중' },
  { value: 'DONE', label: '완독' },
  { value: 'WISHLIST', label: '읽고 싶음' },
]

export default function BookListPage() {
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const [filter, setFilter] = useState<Filter>('ALL')
  const [adding, setAdding] = useState(false)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 로컬 변경과 pull 결과를
  // 모두 자동으로 반영하므로 저장 후 목록을 다시 불러오는 코드가 필요 없다.
  const books = useLiveQuery(() => listBooks(userId, filter), [userId, filter], [])
  const noteCounts = useLiveQuery(() => countNotesByBook(userId), [userId], new Map())

  async function handleSubmit(input: BookInput) {
    await saveBook(userId, input)
    setAdding(false)
    // 큐에 넣은 직후 바로 보낸다. 온라인이면 사용자가 기다리지 않는다.
    syncSoon(userId)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">독서</h1>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`flex-1 rounded-lg px-2 py-2 text-sm ${
              filter === f.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {adding ? (
        <BookForm onSubmit={handleSubmit} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white"
        >
          + 책
        </button>
      )}

      <section className="flex flex-col gap-2">
        {books.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">등록한 책이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {books.map((b) => (
              <li key={b.clientUuid}>
                <Link
                  to={`/books/${b.clientUuid}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900">{b.title}</p>
                    {b.author && <p className="truncate text-xs text-gray-500">{b.author}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {STATUS_LABEL[b.status]}
                    </span>
                    {(noteCounts.get(b.clientUuid) ?? 0) > 0 && (
                      <span className="text-xs text-gray-400">
                        감상평 {noteCounts.get(b.clientUuid)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/BookListPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/book/BookForm.tsx apps/web/src/pages/book/BookListPage.tsx \
        apps/web/src/pages/book/BookListPage.test.tsx
git commit -m "feat(web): 책 목록과 등록 폼

상태를 고르면 짝이 되는 날짜를 오늘로 채운다. 이미 값이 있으면 덮지
않는다 — 과거에 읽은 책을 등록하면서 상태를 바꿀 때 입력한 날짜가
지워지면 안 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 책 상세와 감상평

**Files:**
- Create: `apps/web/src/pages/book/BookNoteForm.tsx`
- Create: `apps/web/src/pages/book/BookDetailPage.tsx`
- Create: `apps/web/src/pages/book/BookDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `getBook`/`listNotesByBook`/`saveNote`/`deleteNote`/`deleteBook`/`saveBook`/`BookNoteInput`, Task 7의 `BookForm`·`STATUS_LABEL`, `useParams`/`useNavigate`(`react-router`)
- Produces:
  - `<BookNoteForm bookClientUuid: string, onSubmit: (input: BookNoteInput) => Promise<void> />`
  - `<BookDetailPage />` — props 없음. `/books/:clientUuid`에서 `clientUuid`를 읽는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/book/BookDetailPage.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookDetailPage from './BookDetailPage.tsx'
import { saveBook, saveNote } from './repository.ts'

const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.books.clear()
  await db.bookNotes.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

const renderAt = (uuid: string) =>
  render(
    <MemoryRouter initialEntries={[`/books/${uuid}`]}>
      <Routes>
        <Route path="/books" element={<p>목록</p>} />
        <Route path="/books/:clientUuid" element={<BookDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )

const makeBook = () => saveBook(USER.id, {
  title: '사피엔스', author: '유발 하라리', summary: '인류의 역사',
  status: 'READING', startedOn: '2026-08-01', finishedOn: null,
})

const makeNote = (bookUuid: string, occurredOn: string, content: string) =>
  saveNote(USER.id, { occurredOn, bookClientUuid: bookUuid, content })

describe('책 상세', () => {
  it('책 정보를 보여준다', async () => {
    const uuid = await makeBook()
    renderAt(uuid)

    expect(await screen.findByText('사피엔스')).toBeInTheDocument()
    expect(screen.getByText('유발 하라리')).toBeInTheDocument()
    expect(screen.getByText('읽는 중')).toBeInTheDocument()
  })

  it('없는 책이면 목록으로 돌려보낸다', async () => {
    renderAt('aaaaaaaa-0000-4000-8000-000000000009')
    expect(await screen.findByText('목록')).toBeInTheDocument()
  })

  it('감상평을 최근 날짜부터 보여준다', async () => {
    const uuid = await makeBook()
    await makeNote(uuid, '2026-08-09', '앞 감상')
    await makeNote(uuid, '2026-08-11', '뒤 감상')

    renderAt(uuid)

    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('뒤 감상')
    expect(items[1]).toHaveTextContent('앞 감상')
  })

  it('감상평을 쓰면 목록에 나타난다', async () => {
    const uuid = await makeBook()
    renderAt(uuid)
    await screen.findByText('사피엔스')

    await userEvent.type(screen.getByLabelText('감상평'), '3부가 인상 깊다')
    await userEvent.click(screen.getByRole('button', { name: '남기기' }))

    expect(await screen.findByText('3부가 인상 깊다')).toBeInTheDocument()
  })

  it('감상평이 있는 책을 지울 때 몇 건인지 알린다', async () => {
    const uuid = await makeBook()
    await makeNote(uuid, '2026-08-11', '좋다')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderAt(uuid)
    await screen.findByText('사피엔스')
    await userEvent.click(screen.getByRole('button', { name: '책 삭제' }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('감상평 1건'))
    // 취소했으므로 그대로 남는다.
    expect((await db.books.get(uuid))?.deletedAt).toBeNull()
    confirmSpy.mockRestore()
  })

  it('책을 지워도 감상평은 남는다', async () => {
    const uuid = await makeBook()
    const noteUuid = await makeNote(uuid, '2026-08-11', '좋다')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderAt(uuid)
    await screen.findByText('사피엔스')
    await userEvent.click(screen.getByRole('button', { name: '책 삭제' }))

    await waitFor(async () => {
      expect((await db.books.get(uuid))?.deletedAt).not.toBeNull()
    })
    expect((await db.bookNotes.get(noteUuid))?.deletedAt).toBeNull()
    confirmSpy.mockRestore()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/BookDetailPage.test.tsx`
Expected: FAIL — `./BookDetailPage.tsx`가 없다.

- [ ] **Step 3: `BookNoteForm`을 만든다**

`apps/web/src/pages/book/BookNoteForm.tsx`

```tsx
import { useState, type FormEvent } from 'react'
import { kstDate } from '@daily/shared'
import type { BookNoteInput } from './repository.ts'

interface Props {
  bookClientUuid: string
  onSubmit: (input: BookNoteInput) => Promise<void>
}

export default function BookNoteForm({ bookClientUuid, onSubmit }: Props) {
  const [occurredOn, setOccurredOn] = useState(() => kstDate(new Date()))
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (trimmed === '') {
      setError('감상평을 입력해 주세요.')
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({ occurredOn, bookClientUuid, content: trimmed })
      setContent('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4"
    >
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">날짜</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">감상평</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={4}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        남기기
      </button>
    </form>
  )
}
```

- [ ] **Step 4: `BookDetailPage`를 만든다**

`apps/web/src/pages/book/BookDetailPage.tsx`

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookForm, { STATUS_LABEL } from './BookForm.tsx'
import BookNoteForm from './BookNoteForm.tsx'
import {
  deleteBook, deleteNote, getBook, listNotesByBook, saveBook, saveNote,
  type BookInput, type BookNoteInput,
} from './repository.ts'

export default function BookDetailPage() {
  const { clientUuid = '' } = useParams()
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)

  const userId = user?.id ?? 0
  const [editing, setEditing] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  // undefined는 "아직 읽는 중", null은 "없는 책"이다. 둘을 구분하지 않으면
  // 로딩 한 틱 동안 목록으로 튕긴다.
  const book = useLiveQuery(
    async () => (await getBook(userId, clientUuid)) ?? null,
    [userId, clientUuid],
  )
  const notes = useLiveQuery(
    () => listNotesByBook(userId, clientUuid), [userId, clientUuid], [],
  )

  if (book === undefined) {
    return <main className="grid min-h-dvh place-items-center">불러오는 중…</main>
  }
  // 다른 기기에서 지웠거나 아직 pull되지 않았다.
  if (book === null) return <Navigate to="/books" replace />

  async function handleEdit(input: BookInput) {
    await saveBook(userId, input, clientUuid)
    setEditing(false)
    syncSoon(userId)
  }

  async function handleNote(input: BookNoteInput) {
    await saveNote(userId, input)
    syncSoon(userId)
  }

  async function handleDeleteNote(noteUuid: string) {
    await deleteNote(userId, noteUuid)
    syncSoon(userId)
  }

  async function handleDeleteBook() {
    // 감상평은 함께 지우지 않는다. 몇 건이 보이지 않게 되는지 먼저 알린다.
    const warning = notes.length > 0
      ? `감상평 ${notes.length}건이 함께 보이지 않게 됩니다.\n`
      : ''
    if (!window.confirm(`${warning}"${book.title}"을(를) 삭제할까요?`)) return

    await deleteBook(userId, clientUuid)
    syncSoon(userId)
    void navigate('/books', { replace: true })
  }

  const period = [book.startedOn, book.finishedOn].some(Boolean)
    ? `${book.startedOn ?? '?'} ~ ${book.finishedOn ?? '읽는 중'}`
    : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void navigate('/books')}
          className="text-sm underline"
        >
          ← 목록
        </button>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditing(true)} className="text-sm underline">
            수정
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteBook()}
            className="text-sm text-gray-400 underline"
          >
            책 삭제
          </button>
        </div>
      </header>

      {editing ? (
        <BookForm initial={book} onSubmit={handleEdit} onCancel={() => setEditing(false)} />
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4">
          <h1 className="text-lg font-semibold">{book.title}</h1>
          {book.author && <p className="text-sm text-gray-500">{book.author}</p>}
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {STATUS_LABEL[book.status]}
            </span>
            {period && <span className="text-xs text-gray-400">{period}</span>}
          </div>
          {book.summary && (
            <button
              type="button"
              onClick={() => setShowSummary((v) => !v)}
              className="text-left text-sm text-gray-600"
            >
              {showSummary ? book.summary : '책 소개 보기'}
            </button>
          )}
        </section>
      )}

      <BookNoteForm bookClientUuid={clientUuid} onSubmit={handleNote} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-600">감상평 {notes.length}</h2>
        {notes.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">아직 남긴 감상평이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li
                key={n.clientUuid}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">{n.occurredOn}</p>
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{n.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteNote(n.clientUuid)}
                  aria-label="감상평 삭제"
                  className="shrink-0 text-xs text-gray-400 underline"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm --filter web test -- pages/book/BookDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Task 6의 Step 2를 적용한다**

이제 `BookListPage`와 `BookDetailPage`가 있으므로 `App.tsx` 라우트와 `ExpensePage`의 `pb-20`을 적용한다.

- [ ] **Step 7: 전체 검증**

Run: `pnpm build && pnpm test`
Expected: 둘 다 성공

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/pages/book/BookNoteForm.tsx apps/web/src/pages/book/BookDetailPage.tsx \
        apps/web/src/pages/book/BookDetailPage.test.tsx \
        apps/web/src/components/TabBar.tsx apps/web/src/App.tsx \
        apps/web/src/pages/expense/ExpensePage.tsx
git commit -m "feat(web): 책 상세와 감상평, 하단 탭바

책을 지워도 감상평은 남긴다. 몇 건이 보이지 않게 되는지 확인 문구로
먼저 알린다. 상세는 목록 안쪽 화면이라 탭바를 감춘다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 마무리 확인

계획을 끝낸 뒤 아래를 직접 확인한다. 이 목록은 커밋 대상이 아니라 점검용이다.

- [ ] `pnpm build && pnpm test` 통과
- [ ] `pnpm --filter api db:comments` — 스키마 변경은 없지만 코멘트가 DB에 반영되어 있는지 확인
- [ ] 오프라인 시나리오를 손으로 한 번 돌린다: DevTools에서 오프라인 → 책 등록 → 감상평 작성 → 온라인 복귀 → 두 건이 순서대로 APPLIED 되는지
- [ ] `CLAUDE.md`의 현재 상태 표에서 "일기·식사·운동·독서 | 미착수"를 독서만 완료로 가른다

---

## 설계 문서와 달라진 점

| 항목 | 설계 §11 | 이 계획 | 이유 |
|---|---|---|---|
| 작업 순서 | shared → registry → 결함 → Dexie | 결함(c) → shared → Dexie → 배선 | `SYNC_TABLE` 확장이 api·web을 동시에 깨뜨려 하나의 커밋 단위가 된다. 결함은 그 전에 전부 끝난다 |
| 결함 (a)(b) 수정 시점 | 독립 단계 | Task 4에 포함 | (a)는 books가 있어야 실제로 실패하고, (b)는 books가 있어야 유출이 된다. 그 전에는 통과하는 테스트만 쓸 수 있다 |

두 변경 모두 "결함을 고치지 않은 채 스토어를 늘리지 않는다"는 설계 의도를 약화시키지 않는다 — 오히려 (c)가 독서 코드보다 앞서고, (a)(b)는 books를 다루는 바로 그 커밋에서 해소된다.
