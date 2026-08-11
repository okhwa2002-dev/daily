# 독서 기록 설계

작성일: 2026-08-11

---

## 1. 목표

책 목록과 감상평을 기록하는 화면을 추가한다. 책은 마스터(`occurred_on` 없음), 감상평은 책당 N개의 기록(`occurred_on` 있음)이다.

DB 테이블(`books`, `book_notes`)·인덱스·CHECK·컬럼 코멘트는 1단계에서 이미 만들어져 있다. 이 설계가 다루는 것은 그 위의 동기화 배선과 화면이다.

### 순서를 앞당긴 것에 대해

[전체 설계](2026-08-06-daily-tracker-design.md) §9는 독서를 마지막(일기 → 식사·운동 다음)으로 권고했다. 부모-자식 동기화가 필요한 유일한 기능이기 때문이다. 이번에는 그 순서를 앞당긴다.

대가는 명확하다 — 아직 한 번도 실행된 적 없는 `CONFLICT` 경로(부모 못 찾음 → 큐 유지 → 재시도)를 이번에 함께 검증해야 한다. 지출→카테고리는 `required: false`라 부모가 없어도 `null`로 저장되므로, 그 경로에 들어간 적이 없다.

---

## 2. 파일 구조

```
apps/web/src/
├── components/
│   └── TabBar.tsx              지출 / 독서
└── pages/book/
    ├── BookListPage.tsx        상태 필터 + 목록 + 책 추가
    ├── BookForm.tsx            제목·저자·요약·상태·시작일·종료일
    ├── BookDetailPage.tsx      책 정보 + 감상평 목록
    ├── BookNoteForm.tsx        감상평 작성
    └── repository.ts           Dexie 읽기/쓰기 + 아웃박스 적재
```

`pages/<기능>/` 규칙을 그대로 따른다. `pages/book/`은 `pages/expense/`를 임포트하지 않는다.

### 라우팅

| 경로 | 화면 | 탭바 |
|---|---|---|
| `/` | 지출 | 보임 |
| `/books` | 책 목록 | 보임 |
| `/books/:clientUuid` | 책 상세 + 감상평 | 감춤 |

화면 간 이동 수단이 이번에 처음 필요해진다. `components/TabBar.tsx` 하나를 만들고 지출·독서 두 항목으로 시작한다. 일기·식사·운동은 배열에 한 줄씩 더하면 된다.

상세 화면에서 탭바를 감추는 이유는 화면이 스택 관계이기 때문이다. 목록에서 들어온 상세에서 다른 탭으로 바로 나가면 돌아올 자리를 잃는다.

---

## 3. shared 스키마

`packages/shared/src/sync.ts`에 추가한다.

```ts
export const SYNC_TABLE = [
  'expense_categories', 'expenses', 'books', 'book_notes',
] as const
```

```ts
export const bookPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(100).nullable().default(null),
  summary: z.string().max(2000).nullable().default(null),
  status: z.enum(BOOK_STATUS),
  startedOn: occurredOnSchema.nullable().default(null),
  finishedOn: occurredOnSchema.nullable().default(null),
}).strict().refine(
  (b) => b.finishedOn === null || b.startedOn === null || b.finishedOn >= b.startedOn,
  { message: '완독일은 시작일보다 앞설 수 없습니다.', path: ['finishedOn'] },
)

export const bookNotePayloadSchema = z.object({
  occurredOn: occurredOnSchema,
  /** 부모 책. 서버가 이 UUID로 book_id를 확정한다. null을 허용하지 않는다 */
  bookClientUuid: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
}).strict()
```

### `refine`이 없으면 안 되는 이유

`books_period_ck` CHECK를 위반한 입력이 서버에 닿으면 INSERT가 DB 에러로 죽는다. 그 에러는 `REJECTED`(영구 실패)가 아니라 500이고, 500은 재시도 대상이라 **그 항목이 큐에서 영원히 빠지지 않는다.**

zod에서 막으면 `REJECTED`조차 되지 않는다 — 폼 검증에서 걸려 서버로 나가지 않는다. DB CHECK는 최후 방어선으로 남긴다. 두 곳 모두에서 막는다는 규칙 그대로다.

### `SCHEMA_VERSION`을 2로 올린다

캐시된 구버전 PWA는 `books`를 모른다. pull로 책 행이 내려오면 `APPLIERS[row.table]`이 `undefined`가 되어 동기화 루프가 통째로 죽는다. 사용자에게는 "기록이 안 올라감"으로 나타나고, 원인은 화면 어디에도 보이지 않는다.

버전을 올리면 서버가 구버전 push를 426으로 막고 Service Worker 갱신을 유도한다.

---

## 4. 서버 동기화 레지스트리

`apps/api/src/sync/registry.ts`의 `SYNC_REGISTRY`에 두 항목을 더한다.

```ts
books: define<BookPayload>({
  table: books,
  payload: bookPayloadSchema,
  hasOccurredOn: false,
  toColumns: (p) => ({
    title: p.title, author: p.author, summary: p.summary,
    status: p.status, startedOn: p.startedOn, finishedOn: p.finishedOn,
  }),
  toPayload: (r) => ({ /* 역방향 */ }),
}),

book_notes: define<BookNotePayload>({
  table: bookNotes,
  payload: bookNotePayloadSchema,
  hasOccurredOn: true,
  parent: {
    uuidField: 'bookClientUuid',
    parentTable: books,
    required: true,        // 이 프로젝트에서 처음 쓰이는 값
  },
  toColumns: (p, parentId) => {
    // required: true라 resolveParentId가 null을 돌려주지 않는다.
    // 도달 불가능하지만 non-null 단언 대신 명시적으로 막는다 —
    // book_id는 NOT NULL이고, null이 새어들면 DB 에러(500)라 큐가 막힌다.
    if (parentId === null) throw new Error('book_notes에 부모 책이 없습니다.')
    return {
      occurredOn: p.occurredOn,
      bookId: parentId,
      bookClientUuid: p.bookClientUuid,
      content: p.content,
    }
  },
  toPayload: (r) => ({ /* 역방향 */ }),
}),
```

레지스트리에 항목을 더하면 push·pull·검증 세 곳이 함께 따라온다. 라우트에는 손댈 것이 없다.

### 부모-자식 동기화가 실제로 도는 경로

```
1. 오프라인에서 책 등록 → 감상평 작성
2. 아웃박스는 seq 순서대로 전송 → 책이 감상평보다 먼저 나간다
3. 서버: (user_id, book_client_uuid)로 books 조회 → book_id 확정 → 감상평 저장
4. 부모를 못 찾으면 CONFLICT → 클라이언트는 큐에 남기고 다음 주기에 재시도
```

`enqueue`의 compaction이 "가장 오래된 seq를 유지"하는 것이 2를 지탱한다. 책을 등록하고 감상평을 쓴 뒤 다시 책 제목을 고쳐도, 책의 seq는 원래 값을 유지하므로 여전히 감상평보다 앞선다.

`resolveParentId`가 `liveOwnedBy`가 아닌 `ownedBy`를 쓰는 것도 그대로 유효하다 — 삭제된 책도 부모로 찾아야 그 책의 감상평이 CONFLICT에 갇히지 않는다.

---

## 5. 로컬 저장소 (Dexie version 3)

```ts
this.version(3).stores({
  books:     'clientUuid, userId, [userId+status]',
  bookNotes: 'clientUuid, userId, bookClientUuid, [userId+occurredOn]',
})
```

| 인덱스 | 쓰임 |
|---|---|
| `[userId+status]` | 목록의 상태 필터 |
| `bookClientUuid` | 상세 화면에서 그 책의 감상평 |
| `[userId+occurredOn]` | 이후 캘린더·통계 |

`deletedAt`은 인덱스에 넣지 않는다. IndexedDB가 `null`을 키로 쓰지 못해 살아있는 레코드가 인덱스에서 통째로 빠진다. 기존 `expenses`와 같은 이유로 JS에서 거른다.

로컬 타입:

```ts
export interface LocalBook extends LocalRecord {
  title: string
  author: string | null
  summary: string | null
  status: BookStatus
  startedOn: string | null
  finishedOn: string | null
}

export interface LocalBookNote extends LocalRecord {
  occurredOn: string
  bookClientUuid: string
  content: string
}
```

---

## 6. 기존 코드의 결함 3건

독서 때문에 새로 생기는 문제가 아니다. **이미 있는데 동기화 테이블이 둘뿐이라 드러나지 않던 것들**이고, 세 번째 테이블이 들어오는 순간 전부 실제 장애가 된다.

### (a) `recordServerId`의 테이블 삼항 분기

`apps/web/src/sync/apply.ts`

```ts
const target = table === 'expenses' ? db.expenses : db.expenseCategories
```

`books`가 들어오면 else로 떨어져 **책의 serverId가 `expenseCategories`에 기록된다.** 책 레코드의 `serverId`는 `null`로 남고, `serverId`가 없으면 삭제가 툼스톤으로 전파되지 않는다 — 지운 책이 다른 기기에서 되살아난다.

`Record<SyncTable, …>` 맵으로 바꾼다. `SYNC_TABLE`에 항목을 추가하면 이 맵도 컴파일 에러로 따라온다.

### (b) `clearLocalData`의 하드코딩된 테이블 목록

`apps/web/src/sync/engine.ts`

비울 테이블이 이름으로 나열되어 있다. `books`·`bookNotes`를 빠뜨리면 **로그아웃해도 독서 기록이 기기에 남아 다음 사용자가 그대로 본다.** 개인 기록 유출이다.

`db.tables` 순회로 바꿔 테이블 추가에 자동으로 따라오게 한다. 순회 방식이면 "빠뜨림"이라는 실패 방식 자체가 사라진다.

### (c) `CONFLICT`의 재시도 상한 없음

`apps/web/src/sync/engine.ts`

```ts
case 'CONFLICT':
  await markRetry(row.seq, result.reason ?? '부모 레코드를 기다리는 중입니다.')
```

`tryCount`는 올라가지만 상한이 없다. 부모 책이 `REJECTED`로 격리되면 그 책의 감상평은 **영원히** CONFLICT를 반복한다. `pendingCount`가 0이 되지 않아 로그아웃할 때마다 "동기화되지 않은 기록 N건" 경고가 뜨고, 사용자는 그것을 없앨 방법이 없다.

`tryCount`가 상한(10)을 넘긴 CONFLICT는 `quarantine`으로 보내고 큐에서 제거한다. 부모 없이 10주기를 넘겼다면 부모가 영구 실패했다고 보는 것이 맞다. 격리된 항목은 버려지지 않고 `syncFailures`에 남는다.

상한 값 10은 push 주기 기준 수 분에 해당한다. 일시적인 네트워크 단절로 부모 전송이 밀리는 경우를 덮기에 충분하고, 영구 실패를 무한정 끌지 않을 만큼 짧다.

---

## 7. 상태와 날짜

`status`는 라디오 3개다.

| 값 | 라벨 | 날짜 자동 채움 |
|---|---|---|
| `WISHLIST` | 읽고 싶음 | 없음 |
| `READING` | 읽는 중 | `startedOn`이 비어 있으면 오늘 |
| `DONE` | 완독 | `finishedOn`이 비어 있으면 오늘 |

자동으로 채운 날짜는 폼에서 그대로 고칠 수 있다. 이미 값이 있으면 덮지 않는다 — 과거에 읽은 책을 등록하면서 상태를 바꿀 때 사용자가 입력한 날짜를 지우면 안 된다.

`WISHLIST`에서 `DONE`으로 건너뛰면 `startedOn`은 `null`이고 `finishedOn`만 있다. CHECK가 허용하는 조합이다.

---

## 8. 삭제 규칙

**책을 지워도 감상평은 건드리지 않는다.**

캐스케이드 소프트 삭제를 하면 감상평 N건이 한꺼번에 아웃박스에 쌓이고, 되살릴 때 어떤 감상평이 그 삭제로 지워진 것인지 구분할 수 없다. 삭제된 책은 목록에 뜨지 않으므로 그 감상평으로 들어갈 경로도 없다.

감상평이 하나라도 있는 책을 지울 때는 몇 건이 함께 보이지 않게 되는지 확인 문구로 알린다.

감상평 단건 삭제는 지출과 같다 — 툼스톤 + 아웃박스 DELETE.

---

## 9. 화면

### 목록 (`/books`)

- 상태 탭(전체·읽는 중·완독·읽고 싶음) → `[userId+status]` 인덱스로 조회
- 정렬: 상태 내에서 `updatedAt` 역순
- 각 행: 제목, 저자, 상태 배지, 감상평 수
- 하단 "+ 책" 버튼 → `BookForm`
- 행 탭 → 상세

### 상세 (`/books/:clientUuid`)

- 상단: 제목·저자·상태·기간, 수정/삭제
- `summary`는 접어 두고 탭하면 펼친다
- 감상평 목록: `occurredOn` 역순, 각 항목에 날짜와 본문, 삭제
- 하단 `BookNoteForm` — 날짜(기본 오늘) + 본문

없는 `clientUuid`로 들어오면(다른 기기에서 지웠거나 pull 전) 목록으로 돌려보낸다.

### 데이터 접근

지출과 같다. 화면은 Dexie만 읽고, `useLiveQuery`가 로컬 변경과 pull 결과를 모두 반영한다. 저장 후 `syncSoon(userId)`로 즉시 전송을 건다.

---

## 10. 테스트

동기화 배선을 테스트로 굳힌 뒤 화면을 올린다. 상태 조합이 많은 쪽이 아래에 있고, 그쪽이 나중에 붙이면 검증 불가능해지는 쪽이다.

| 대상 | 검증 |
|---|---|
| shared | `finishedOn < startedOn` 거부, 한쪽이 `null`이면 통과 |
| shared | `bookNotePayloadSchema`가 `bookClientUuid: null` 거부 |
| api registry | 부모 없음 → `CONFLICT` (`REJECTED` 아님) |
| api registry | 부모 push 후 재시도 → `APPLIED`, `book_id` 확정 |
| api registry | **남의 책 UUID를 부모로 지정 → `CONFLICT`** (소유권 격리) |
| api registry | 삭제된 책도 부모로 찾는다 |
| web apply | `recordServerId`가 테이블별로 올바른 스토어에 쓴다 |
| web engine | `clearLocalData` 후 모든 스토어가 빈다 |
| web engine | `tryCount` 상한 초과 CONFLICT → `quarantine` + 큐에서 제거 |
| web repository | 책 → 감상평 순서로 아웃박스 seq가 잡힌다 |
| web repository | 책을 수정해도 seq가 유지되어 감상평보다 앞선다 |
| web repository | 책 삭제 시 감상평은 툼스톤이 되지 않는다 |

---

## 11. 구현 순서

1. 결함 (c) CONFLICT 재시도 상한
2. shared 페이로드 스키마 (`SYNC_TABLE`은 아직 건드리지 않는다)
3. Dexie version(3) + 로컬 타입
4. `SYNC_TABLE` 확장 + `SCHEMA_VERSION` 2 + 서버 레지스트리 + 웹 `APPLIERS` + 결함 (a)(b)
5. `pages/book/repository.ts`
6. `TabBar` + 라우팅
7. `BookListPage` / `BookForm`
8. `BookDetailPage` / `BookNoteForm`

결함을 먼저 고치는 것은 의도한 것이다. 고치지 않은 채 로컬 스토어를 늘리면 (a)와 (b)가 조용히 잘못된 데이터를 만들고, 그 상태에서 화면을 붙이면 원인을 화면에서 찾게 된다.

4단계가 큰 이유는 쪼갤 수 없기 때문이다. `SYNC_TABLE`에 항목을 더하는 순간 `SYNC_REGISTRY`(api)와 `APPLIERS`·`recordServerId`(web)가 **동시에** 컴파일 에러가 난다 — 셋 다 `Record<SyncTable, …>`이다. 나눠 커밋하면 중간 상태에서 `pnpm build`가 깨진다.

(a)와 (b)가 4단계에 묶이는 것도 같은 이유다. 그 둘은 `books`가 존재해야 비로소 실패하는 결함이라, 그 전에는 통과하는 테스트밖에 쓸 수 없다. (c)만 지금 상태에서 재현되므로 1단계로 앞세운다.

세부 단계는 [구현 계획](../plans/2026-08-11-book-tracking.md) 참고.

---

## 12. 범위에서 제외

| 항목 | 사유 |
|---|---|
| 페이지 진도율·독서 시간·별점 | 전체 설계에서 제외한 그대로 |
| ISBN 조회·표지 이미지 | 외부 API 의존이 생긴다 |
| 감상평 수정 | 삭제 후 재작성으로 충분하다. 요구가 나오면 추가 |
| 책 검색 | 목록이 수십 권 규모에서 필요 없다 |
