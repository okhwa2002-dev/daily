# 데이터베이스 규칙

PostgreSQL 18. 마이그레이션은 drizzle-kit으로 관리하며, 모든 마이그레이션은 멱등하게 작성한다.

---

## 공통 컬럼

모든 도메인 테이블은 아래 컬럼을 갖는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | 서버 채번. DB 내부 식별자·FK·인덱스에 사용 |
| `client_uuid` | `UUID NOT NULL` | 클라이언트 생성. 동기화 식별자 |
| `user_id` | `BIGINT NOT NULL` | 소유자 |
| `created_at` | `TIMESTAMP NOT NULL` | 등록 일시 |
| `created_by` | `BIGINT NOT NULL` | 등록자 user_id |
| `updated_at` | `TIMESTAMP NOT NULL` | 수정 일시 (충돌 판정 기준) |
| `updated_by` | `BIGINT NOT NULL` | 수정자 user_id |
| `deleted_at` | `TIMESTAMP NULL` | 소프트 삭제 일시. NULL이면 정상 |
| `deleted_by` | `BIGINT NULL` | 삭제자 user_id |
| `synced_at` | `TIMESTAMP NOT NULL` | 서버가 찍는 동기화 커서 |

**`_at` 컬럼을 만들면 짝이 되는 `_by` 컬럼을 반드시 함께 만들고 해당 사용자 ID를 넣는다.**
`_by` 없이 `_at`만 있는 컬럼은 허용하지 않는다.

- 행위자가 존재하지 않는 경우(가입 직전, 시스템 배치)는 `0`을 시스템 사용자 sentinel로 넣는다.
- 예외는 인증 **전** 이벤트를 기록하는 테이블뿐이다. `login_attempts`는 없는 계정으로 시도한 경우 행위자 ID가 존재하지 않으므로 `_by`를 두지 않고 `email`과 `ip`를 남긴다. 이런 예외를 새로 만들 때는 이 문서에 이유와 함께 적는다.

기록 테이블은 위에 더해 `occurred_on DATE NOT NULL`(기록 대상 날짜)을 갖는다.

**예외**: `books`는 특정 날짜의 기록이 아니라 마스터 데이터이므로 `occurred_on`이 없다. 공통 컬럼은 그대로 갖는다.

---

## 날짜와 시각

- 시각 컬럼은 `TIMESTAMP`(타임존 없음)로 **KST 로컬 시각**을 저장한다. `TIMESTAMPTZ`는 사용하지 않는다.
- 클라이언트가 보낸 `updated_at`은 서버 진입 시점에 KST로 정규화한 뒤 저장한다.
  정규화를 빠뜨리면 기기 타임존이 다를 때 최신 판정이 뒤집힌다.
- `synced_at`은 서버가 직접 찍는다. 클라이언트 값을 그대로 쓰지 않는다.
- 사용자가 보는 "그 날의 기록"은 `occurred_on DATE`로 표현한다. 시각 컬럼으로 날짜를 판단하지 않는다.

---

## 소프트 삭제

`deleted_at`이 있는 테이블은 물리 삭제를 하지 않는다.

```sql
-- 삭제
UPDATE {table}
   SET deleted_at = NOW(), deleted_by = :userId,
       updated_at = NOW(), updated_by = :userId
 WHERE id = :id AND user_id = :userId;

-- 조회
SELECT * FROM {table}
 WHERE user_id = :userId AND deleted_at IS NULL;
```

- `DELETE FROM`은 금지한다. 삭제도 다른 기기로 전파되어야 하므로 툼스톤이 남아야 한다.
- 조회 쿼리에 `deleted_at IS NULL`을 빠뜨리지 않는다. 단, 동기화 pull 쿼리는 예외로 삭제된 행도 함께 내려보낸다.

---

## 소유권 격리

- 모든 조회·수정·삭제 쿼리에 `user_id = :userId` 조건을 포함한다.
- `userId`는 인증 미들웨어가 주입한 값만 사용한다. 요청 본문이나 쿼리스트링의 사용자 ID는 신뢰하지 않는다.
- 조건 없이 테이블 전체를 읽는 쿼리는 관리·배치 목적이라도 별도 검토 없이 작성하지 않는다.

---

## 멱등 업서트

동기화 수신은 항상 `client_uuid` 기준 업서트로 처리한다.

```sql
INSERT INTO {table} (...)
VALUES (...)
ON CONFLICT (user_id, client_uuid) DO UPDATE
   SET ...
 WHERE {table}.updated_at < EXCLUDED.updated_at;
```

- `UNIQUE(user_id, client_uuid)` 제약을 반드시 건다.
- `WHERE ... updated_at <` 조건이 last-write-wins 충돌 해결을 담당한다. 오래된 변경이 최신 값을 덮어쓰지 못한다.
- 재전송이 발생해도 중복 행이 생기지 않아야 한다.

---

## 인덱스

기본으로 다음 두 축을 만든다.

```sql
CREATE INDEX ON {table} (user_id, occurred_on);   -- 화면 조회
CREATE INDEX ON {table} (user_id, synced_at, id); -- 동기화 pull
CREATE UNIQUE INDEX ON {table} (user_id, client_uuid);
```

pull 커서는 `(synced_at, id)` 복합이다. 같은 시각에 저장된 행이 여러 개일 때 타임스탬프만으로는 경계에서 행이 누락되거나 같은 행을 무한 반복한다.

---

## 금액과 수치

- 금액은 `NUMERIC(12,2)`를 사용한다. `FLOAT`/`DOUBLE`은 금지한다.
- 애플리케이션에서 금액은 문자열 또는 정수(최소 단위)로 다루고, 부동소수점 연산을 거치지 않는다.

---

## 네이밍

| 대상 | 규칙 |
|---|---|
| 테이블 | 복수형 snake_case (`expenses`, `expense_categories`) |
| 컬럼 | snake_case |
| 애플리케이션 타입 | camelCase — DB row ↔ 도메인 타입 변환은 명시적 매퍼 함수로 처리 |

---

## 코드성 데이터

상태·구분·유형처럼 **정해진 값 집합에서 고르는 데이터는 값을 대문자로 관리한다.**

```
kind      → 'INCOME' | 'EXPENSE'
status    → 'READING' | 'DONE' | 'WISHLIST'
slot      → 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK'
portion   → 'LIGHT' | 'NORMAL' | 'HEAVY'
```

- 여러 단어는 `SCREAMING_SNAKE_CASE`로 쓴다 (`PENDING_DELETION`, `FULL_BODY`).
- DB는 `TEXT` + `CHECK` 제약, 애플리케이션은 zod enum으로 검증한다. 두 곳 모두에서 막는다.
- **컬럼명·테이블명은 그대로 snake_case 소문자다.** 대문자 규칙은 값에만 적용된다.
- 화면에 보이는 한글 라벨은 코드값과 분리해 프론트에서 매핑한다. DB에 표시용 문자열을 넣지 않는다.

코드값과 자유 입력 텍스트가 한눈에 구분되는 것이 목적이다. 쿼리나 로그에서 `'EXPENSE'`는 코드, `'점심 김밥'`은 사용자 입력임이 형태만으로 드러난다.
