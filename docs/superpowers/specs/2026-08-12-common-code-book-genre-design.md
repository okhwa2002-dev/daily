# 공통코드 테이블과 독서 장르 설계

작성일: 2026-08-12

---

## 1. 목표

책에 장르 구분을 추가한다. 다만 장르를 코드 상수로 박지 않고, **코드 그룹과 코드를 관리하는 공통코드 테이블**을 만들어 그 위에 올린다.

다른 업무의 코드성 데이터도 이후 같은 테이블로 옮길 예정이다. **이번 범위는 공통코드 구조 신설 + 장르 하나뿐이다.** 기존 `EXPENSE_KIND`·`MEAL_SLOT`·`BOOK_STATUS` 등은 그대로 둔다.

### 프로젝트 규칙과의 충돌을 먼저 적는다

[database.md](../../../.claude/roles/database.md)의 코드성 데이터 절은 "DB는 `TEXT` + `CHECK`, 애플리케이션은 zod enum으로 검증한다. 두 곳 모두에서 막는다"고 못박고 있다. 공통코드 방식은 이 둘을 모두 포기한다 — 값 집합이 런타임 데이터가 되므로 `CHECK`로 표현할 수 없고, `BookStatus` 같은 컴파일타임 유니온 타입도 만들 수 없다.

대가로 얻는 것은 **코드 추가에 배포가 필요 없다**는 것 하나다. 그 교환을 받아들이기로 했으므로, 규칙 문서에 예외를 명시한다(§8).

---

## 2. 테이블

두 테이블 모두 **도메인 테이블이 아니다.** `user_id`·`client_uuid`·`synced_at`을 두지 않는다 — 사용자 데이터가 아니고, 동기화 파이프를 타지 않는다.

감사 컬럼은 규칙대로 `_at`과 `_by`를 짝지어 둔다. 시드가 넣는 행의 행위자는 시스템 sentinel `0`이다.

**`code_groups`** — 코드 그룹

| 컬럼 | 타입 |
|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` |
| `group_code` | `TEXT NOT NULL` — 대문자 코드. `UNIQUE` |
| `name` | `TEXT NOT NULL` — 관리용 한글 이름 |
| 감사 | `created_at/by`, `updated_at/by`, `deleted_at/by` |

**`codes`** — 코드

| 컬럼 | 타입 |
|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` |
| `group_code` | `TEXT NOT NULL` → `code_groups(group_code)` FK |
| `code` | `TEXT NOT NULL` — 대문자 코드 |
| `name` | `TEXT NOT NULL` — **화면에 뜨는 한글 라벨** |
| `sort_order` | `INTEGER NOT NULL` — 선택 목록 정렬 |
| 감사 | `created_at/by`, `updated_at/by`, `deleted_at/by` |

`UNIQUE(group_code, code)`, 조회 인덱스 `(group_code, sort_order)`.

`name`이 화면 라벨이라는 점이 이 구조의 요점이다. 지금까지 라벨은 `STATUS_LABEL` 같은 프론트 상수였지만, 장르 라벨은 DB에서 온다.

**컬럼 코멘트를 전부 달고 두 테이블을 `ALL_COLUMN_COMMENTS`에 추가한다.** 빠뜨리면 `column-comments.test.ts`가 잡는다.

### 초기 시드

마이그레이션에서 `ON CONFLICT DO NOTHING`으로 넣는다. 멱등해야 한다.

```
code_groups: ('BOOK_GENRE', '독서 장르')
codes:       NOVEL 소설 / ESSAY 에세이 / HUMANITIES 인문 /
             SCIENCE 과학 / TECH 기술 / ECONOMY 경제 / ETC 기타
```

이후 장르 추가는 운영 DB에 SQL로 반영한다. 배포가 필요 없는 것이 이 방식의 실질 이득이다.

---

## 3. `books.genre` — FK도 CHECK도 걸지 않는다

`genre TEXT NULL`에 코드값(`'NOVEL'`)을 그대로 저장한다.

### FK를 걸지 않는 이유

오프라인 기기가 관리자가 방금 지운 코드로 책을 만들어 push하면 FK 위반이 DB 에러가 되고, 그 에러는 500이다. **500은 `REJECTED`가 아니라 재시도 대상이라 그 항목이 큐에서 영원히 빠지지 않는다.** 같은 실패 방식을 이 프로젝트에서 이미 두 번 고쳤다 — `books_period_ck`를 zod `refine`으로 앞당겨 막은 것과, `book_notes.book_id` NOT NULL을 `toColumns`에서 명시적으로 막은 것이다.

### 대신 서버가 검증한다

sync 레지스트리의 페이로드 검증 단계에서 `codes` 테이블과 대조한다. 모르는 코드면 `REJECTED`(영구 실패)로 돌려준다. 큐에서 빠지고 사용자에게 알려진다.

`genre`가 `null`이면 검증을 건너뛴다. 미지정은 정상이다.

**검증은 "존재"만 본다 — 삭제된 코드도 통과시킨다.** `deleted_at`이 찍힌 코드를 거부하면, 관리자가 장르 하나를 지우는 순간 그 장르를 쓰던 사용자의 오프라인 수정이 전부 `REJECTED`가 되어 버려진다. 사용자는 자기가 잘못한 것이 없는데 기록을 잃는다.

`sync/push.ts`의 `resolveParentId`가 `liveOwnedBy`가 아니라 `ownedBy`를 쓰는 것과 같은 판단이다 — 삭제된 부모도 찾아야 자식이 갇히지 않는다.

새로 고를 수 없는 것은 화면이 막는다. 삭제된 코드는 `GET /codes`에서 빠지므로 선택 목록에 뜨지 않는다(§4). 이미 붙어 있던 값만 살아남는다.

CHECK 제약은 값 집합이 런타임 데이터라 애초에 표현할 수 없다.

---

## 4. 전달 경로 — `GET /api/codes`

`requireAuth` 뒤에 둔다. 인증 전 화면(로그인·회원가입)에는 코드가 필요 없다.

```json
{ "groups": [
  { "groupCode": "BOOK_GENRE", "name": "독서 장르",
    "codes": [{ "code": "NOVEL", "name": "소설", "sortOrder": 1 }] }
] }
```

- 삭제된(`deleted_at IS NOT NULL`) 그룹과 코드는 내려보내지 않는다.
- `sort_order` 순으로 정렬해 내려보낸다. 클라이언트가 다시 정렬하지 않아도 되게 한다.
- 조건부 요청(ETag·`If-Modified-Since`)은 넣지 않는다. 코드는 수십 건 규모다.

**이 라우트는 `sync/` 계층과 무관하다.** push 할 것이 없고(사용자가 만들지 않는다), pull 커서에 얹을 이유도 없다. 동기화 엔진을 건드리지 않는 것이 이 설계의 핵심 제약이다.

---

## 5. 클라이언트 — `src/codes/`

### 로컬 캐시

Dexie version(4):

```ts
codes: '[groupCode+code], groupCode'
```

`sort_order`는 값 컬럼으로만 갖는다. 인덱스로 쓰지 않는다 — 조회 단위가 그룹 하나이고 그 크기가 수십 건이라 JS 정렬로 충분하다.

### 위치

`pages/book/`이 아니라 `src/codes/`에 둔다. 이유가 둘이다.

- 코드 갱신을 거는 주체가 앱 셸(`App.tsx`)이다. 기능 폴더에 두면 `App.tsx`가 기능 폴더를 임포트하게 되고, 그건 "다른 기능의 폴더를 임포트하지 않는다"는 규칙을 셸이 먼저 깨는 것이다.
- 이 테이블의 목적 자체가 여러 업무가 함께 쓰는 것이다.

### 갱신

인증 직후 한 번 호출한다. **실패하면 기존 캐시를 유지한다** — 네트워크가 없다고 장르 목록이 사라지면 안 된다.

최초 로그인은 어차피 온라인이므로 빈 캐시로 시작할 일은 없다. 그래도 캐시가 비어 있으면 장르 선택은 "미지정"만 보인다.

---

## 6. 화면

- `BookForm`: 장르 `<select>` — "미지정" + 코드 목록(`sortOrder` 순)
- `BookListPage`: 각 행에 장르 라벨 표시
- `BookDetailPage`: 상태 배지 옆에 장르 라벨 표시

**캐시에 없는 코드값을 만나면 코드값을 그대로 표시한다.** 관리자가 지운 장르를 쓰던 기존 기록이 "빈칸"이 되면 사용자는 자기 기록이 손상된 것으로 읽는다. 선택 목록에는 안 뜨지만 이미 붙은 기록은 계속 보인다.

**장르 필터는 넣지 않는다.** 상태 필터가 이미 있고, 두 축이 겹치면 목록 UI가 복잡해진다. 요구가 실제로 나오면 그때 추가한다.

---

## 7. `SCHEMA_VERSION`을 3으로 올린다

`books` 페이로드에 `genre`가 추가된다 — 레코드 모양 변경이다.

올리지 않으면 구버전 클라이언트가 책을 수정할 때 `genre` 없는 페이로드를 보내고, 서버가 `genre = null`로 덮는다. LWW라 그 값이 최신이 되어 **다른 기기에서 설정한 장르가 조용히 지워진다.**

426 게이트는 push·pull 양쪽에 이미 걸려 있고, PWA는 `registerType: 'autoUpdate'`라 구버전 기기가 스스로 빠져나온다.

---

## 8. 규칙 문서 갱신

[database.md](../../../.claude/roles/database.md)의 코드성 데이터 절에 예외를 적는다.

> **공통코드 테이블로 관리하는 코드는 예외다.** 값 집합이 런타임 데이터라 `CHECK`와 zod enum으로 표현할 수 없다. 대신 서버가 `codes` 테이블과 대조해 검증하고, 모르는 코드는 `REJECTED`로 돌려준다. 현재 `BOOK_GENRE` 하나가 이 방식이다. 나머지 코드 그룹은 기존대로 `codes.ts` + `CHECK` + zod enum을 쓴다.

값을 대문자로 관리한다는 규칙은 공통코드에도 그대로 적용된다.

---

## 9. 테스트

| 대상 | 검증 |
|---|---|
| api `/codes` | 인증 없이는 401 |
| api `/codes` | 그룹·코드가 `sort_order` 순으로 내려온다 |
| api `/codes` | 삭제된 코드와 그룹은 빠진다 |
| api sync | 모르는 장르 코드로 push → `REJECTED` (500도 `CONFLICT`도 아니다) |
| api sync | `genre: null`은 통과한다 |
| api sync | **삭제된 코드도 통과한다** — 관리자의 삭제가 사용자의 오프라인 수정을 버리면 안 된다 |
| api sync | 유효한 코드는 `APPLIED`, 컬럼에 저장된다 |
| api sync | pull 페이로드에 `genre`가 실린다 |
| shared | `bookPayloadSchema`가 `genre`를 nullable로 받고 기본값이 `null`이다 |
| web codes | API 응답을 캐시에 저장하고 그룹으로 조회한다 |
| web codes | 갱신 실패 시 기존 캐시가 남는다 |
| web codes | 삭제되어 사라진 코드는 캐시에서도 빠진다 |
| web BookForm | 장르 선택지가 `sortOrder` 순으로 뜬다 |
| web BookForm | 미지정으로 저장하면 `genre`가 `null`이다 |
| web 목록·상세 | 캐시에 없는 코드값은 코드값 그대로 표시된다 |

---

## 10. 구현 순서

1. `code_groups`·`codes` 스키마 + 마이그레이션 + 컬럼 코멘트 + 시드
2. `books.genre` 컬럼 + 마이그레이션 + 코멘트
3. shared: `genre` 필드 + `SCHEMA_VERSION` 3
4. api: `GET /codes` 라우트
5. api: sync 레지스트리의 장르 검증
6. web: Dexie version(4) + `src/codes/` 캐시 계층
7. web: 폼·목록·상세 반영
8. 규칙 문서 갱신

1과 2를 나누는 것은 의도한 것이다. 공통코드 구조는 장르와 독립적으로 서고, 이후 다른 업무가 그 위에 올라간다.

---

## 11. 범위에서 제외

| 항목 | 사유 |
|---|---|
| 코드 관리 화면 | `users`에 권한 컬럼이 없어 권한 체계 신설이 선행되어야 한다. 이번 작업이 장르 추가가 아니라 권한 시스템 만들기가 된다 |
| 기존 코드값의 공통코드 이행 | `EXPENSE_KIND` 등은 그대로 둔다. 구조가 검증된 뒤 별도 작업으로 |
| 장르별 통계 | 통계 화면 자체가 미착수다 |
| 장르 필터 | §6 참고. 요구가 확인되지 않았다 |
| 코드 다국어 | 서비스가 한국어 단일이다 |
