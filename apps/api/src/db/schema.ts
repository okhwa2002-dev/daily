import { sql, type SQL } from 'drizzle-orm'
import {
  bigint, bigserial, check, date, index, integer, jsonb, numeric, pgTable,
  text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { columnComments } from './column-comments.ts'
import {
  BODY_PART, BOOK_STATUS, EXPENSE_KIND, INTENSITY, MEAL_SLOT, PORTION,
  USER_STATUS, WORKOUT_KIND, type WorkoutSet,
} from '@daily/shared'

/**
 * 코드성 데이터의 CHECK 제약을 shared의 코드 목록에서 생성한다.
 * 목록을 한 곳에서만 관리해야 zod enum과 DB 제약이 어긋나지 않는다.
 *
 * `sql.raw`를 쓰는 이유: CHECK는 DDL로 렌더링되므로 바인드 파라미터를 넣을 수
 * 없다. 값은 전부 이 저장소가 소유한 대문자 상수라 주입 위험이 없다.
 */
function inCodes(column: AnyPgColumn, codes: readonly string[]): SQL {
  return sql`${column} IN ${sql.raw(`(${codes.map((c) => `'${c}'`).join(', ')})`)}`
}

/** 모든 테이블이 공유하는 감사 컬럼. `_at`에는 반드시 `_by`가 따라붙는다. */
const auditColumns = {
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  createdBy: bigint('created_by', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
  updatedBy: bigint('updated_by', { mode: 'number' }).notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  deletedBy: bigint('deleted_by', { mode: 'number' }),
}

/**
 * 도메인 테이블이 공유하는 동기화 컬럼.
 *
 * `client_uuid`는 오프라인에서 생성되는 동기화 식별자다. 서버 `id`는 전송
 * 후에야 정해지므로, 오프라인 레코드를 가리키려면 이 값이 필요하다.
 * `synced_at`은 pull 커서로, 반드시 서버가 찍는다.
 */
const syncColumns = {
  clientUuid: uuid('client_uuid').notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  syncedAt: timestamp('synced_at', { mode: 'string' }).notNull(),
}

/**
 * 공유 컬럼의 DB 코멘트.
 *
 * 컬럼 정의를 스프레드하듯 코멘트도 스프레드한다. 두 스프레드가 같은 자리에
 * 오므로 컬럼과 코멘트가 따로 놀지 않는다. 실제 `COMMENT ON`은 각 테이블 아래의
 * `columnComments(...)`가 만들고, `db:comments`가 DB에 반영한다.
 */
const AUDIT_COMMENTS = {
  createdAt: '등록 일시 (KST 로컬 시각)',
  createdBy: '등록자 user_id. 행위자가 없으면 시스템 sentinel 0',
  updatedAt: '수정 일시 (KST). 동기화 last-write-wins 판정 기준',
  updatedBy: '수정자 user_id',
  deletedAt: '소프트 삭제 일시. NULL이면 정상 행이며 물리 삭제는 하지 않는다',
  deletedBy: '삭제자 user_id',
} as const

const SYNC_COMMENTS = {
  clientUuid: '동기화 식별자. 클라이언트가 오프라인에서 생성하며 (user_id, client_uuid)로 유일하다',
  userId: '소유자 user_id. 모든 조회·수정·삭제 쿼리에 이 조건을 건다',
  syncedAt: 'pull 커서. 서버가 직접 찍으며 클라이언트 값을 쓰지 않는다',
} as const

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

// ---------------------------------------------------------------------------
// 계정
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 로그인 식별자. 항상 소문자로 정규화되어 저장된다 */
  loginId: text('login_id').notNull(),
  /** 로그인에는 쓰지 않는다. 비밀번호 분실 시 계정을 되찾을 유일한 수단이다 */
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { mode: 'string' }),
  emailVerifiedBy: bigint('email_verified_by', { mode: 'number' }),
  status: text('status').notNull().default('ACTIVE'),
  deletionRequestedAt: timestamp('deletion_requested_at', { mode: 'string' }),
  deletionRequestedBy: bigint('deletion_requested_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [
  uniqueIndex('users_login_id_uq').on(t.loginId),
  uniqueIndex('users_email_uq').on(t.email),
  // 코드성 데이터는 DB와 애플리케이션 양쪽에서 막는다.
  check('users_status_ck', inCodes(t.status, USER_STATUS)),
  // 정규화되지 않은 아이디가 들어오는 경로를 DB에서도 막는다. 대문자가 섞인
  // 행이 하나라도 생기면 '대소문자 무시 유일'이 그 순간부터 거짓이 된다.
  check('users_login_id_ck', sql`${t.loginId} ~ '^[a-z0-9_]{4,20}$'`),
])

export const usersComments = columnComments(users, {
  id: '사용자 내부 식별자',
  loginId: '로그인 식별자. 영문·숫자·밑줄 4~20자를 소문자로 정규화해 저장한다',
  email: '가입 시 필수. 로그인에는 쓰지 않으며 비밀번호 분실 시 계정을 되찾을 유일한 수단이다',
  passwordHash: 'argon2id 해시. 평문이나 역산 가능한 형태로 저장하지 않는다',
  emailVerifiedAt: '이메일 인증 완료 일시. NULL이면 미인증',
  emailVerifiedBy: '인증을 처리한 user_id',
  status: '계정 상태 — ACTIVE | SUSPENDED | PENDING_DELETION',
  deletionRequestedAt: '탈퇴 요청 일시. 유예 후 실제 파기·비식별화로 이어진다',
  deletionRequestedBy: '탈퇴를 요청한 user_id',
  ...AUDIT_COMMENTS,
})

export const refreshTokens = pgTable('refresh_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
  /** 폐기한 주체. 사용자 로그아웃과 재사용 탐지에 의한 시스템 폐기(0)를 구분한다 */
  revokedBy: bigint('revoked_by', { mode: 'number' }),
  /** 로테이션 체인 추적 — 이 토큰을 대체한 토큰의 id (rotate가 옛 행에 새 id를 넣는다) */
  replacedBy: bigint('replaced_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [
  uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
  index('refresh_tokens_user_idx').on(t.userId),
])

export const refreshTokensComments = columnComments(refreshTokens, {
  id: '리프레시 토큰 내부 식별자',
  userId: '토큰 소유자 user_id',
  tokenHash: '토큰 해시. 원문은 저장하지 않는다',
  expiresAt: '만료 일시',
  revokedAt: '폐기 일시. NULL이면 유효',
  revokedBy: '폐기 주체. 사용자 로그아웃과 재사용 탐지에 의한 시스템 폐기(0)를 구분한다',
  replacedBy: '로테이션 체인 추적 — 이 토큰을 대체한 토큰의 id',
  ...AUDIT_COMMENTS,
})

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'string' }),
  usedBy: bigint('used_by', { mode: 'number' }),
  ...auditColumns,
}, (t) => [uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash)])

export const passwordResetTokensComments = columnComments(passwordResetTokens, {
  id: '비밀번호 재설정 토큰 내부 식별자',
  userId: '토큰 소유자 user_id',
  tokenHash: '토큰 해시. 원문은 저장하지 않는다',
  expiresAt: '만료 일시',
  usedAt: '사용 일시. 채워지면 재사용할 수 없다',
  usedBy: '사용한 user_id',
  ...AUDIT_COMMENTS,
})

/**
 * 인증 '전' 이벤트를 기록하므로 감사 컬럼(`_by`)을 갖지 않는다.
 * 없는 계정으로 시도한 경우 행위자 ID가 존재하지 않기 때문이다. 대신 login_id와 ip를 남긴다.
 */
export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 시도한 아이디. 존재하지 않는 계정일 수 있으므로 FK를 걸지 않는다 */
  loginId: text('login_id').notNull(),
  ip: text('ip').notNull(),
  succeeded: text('succeeded').notNull(), // 'Y' | 'N'
  attemptedAt: timestamp('attempted_at', { mode: 'string' }).notNull(),
}, (t) => [
  index('login_attempts_login_id_idx').on(t.loginId, t.attemptedAt),
  check('login_attempts_succeeded_ck', sql`${t.succeeded} IN ('Y', 'N')`),
])

export const loginAttemptsComments = columnComments(loginAttempts, {
  id: '로그인 시도 내부 식별자',
  loginId: '시도한 아이디. 존재하지 않는 계정일 수 있어 FK를 걸지 않는다',
  ip: '시도한 클라이언트 IP. 스로틀링 키로 쓴다',
  succeeded: '성공 여부 — Y | N',
  attemptedAt: '시도 일시 (KST). 반복 실패 제한의 기준 시각',
})

// ---------------------------------------------------------------------------
// 지출
// ---------------------------------------------------------------------------

/**
 * 사용자 정의 카테고리. 특정 날짜의 기록이 아닌 마스터 데이터라 `occurred_on`이 없다.
 *
 * `name`에 유니크 제약을 걸지 않는다. 두 기기에서 오프라인으로 같은 이름을
 * 만들면 서로 다른 `client_uuid`로 올라와 제약에 걸리고, 그 실패는 400(영구
 * 실패)이라 사용자 입력이 버려진다. 중복 이름은 화면에서 다룬다.
 */
export const expenseCategories = pgTable('expense_categories', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  name: text('name').notNull(),
  ...auditColumns,
}, (t) => [
  uniqueIndex('expense_categories_client_uuid_uq').on(t.userId, t.clientUuid),
  index('expense_categories_pull_idx').on(t.userId, t.syncedAt, t.id),
])

export const expenseCategoriesComments = columnComments(expenseCategories, {
  id: '카테고리 내부 식별자',
  ...SYNC_COMMENTS,
  name: '카테고리 이름. 유니크 제약을 걸지 않으므로 같은 이름이 여러 건일 수 있다',
  ...AUDIT_COMMENTS,
})

export const expenses = pgTable('expenses', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  /** 서버가 `category_client_uuid`로 조회해 채운다. 미분류면 NULL */
  categoryId: bigint('category_id', { mode: 'number' })
    .references((): AnyPgColumn => expenseCategories.id),
  /** 동기화용 부모 참조. 오프라인에서 만든 카테고리는 아직 서버 id가 없다 */
  categoryClientUuid: uuid('category_client_uuid'),
  memo: text('memo'),
  ...auditColumns,
}, (t) => [
  uniqueIndex('expenses_client_uuid_uq').on(t.userId, t.clientUuid),
  index('expenses_occurred_idx').on(t.userId, t.occurredOn),
  index('expenses_pull_idx').on(t.userId, t.syncedAt, t.id),
  check('expenses_kind_ck', inCodes(t.kind, EXPENSE_KIND)),
  // 부호는 kind가 가진다. 음수 금액을 허용하면 INCOME -1000의 의미가 모호해진다.
  check('expenses_amount_ck', sql`${t.amount} >= 0`),
])

export const expensesComments = columnComments(expenses, {
  id: '지출 내부 식별자',
  ...SYNC_COMMENTS,
  occurredOn: '기록 대상 날짜. 시각 컬럼으로 날짜를 판단하지 않는다',
  kind: '수입/지출 구분 — INCOME | EXPENSE',
  amount: '금액. 부호는 kind가 가지므로 항상 0 이상이다',
  categoryId: '카테고리 FK. 서버가 category_client_uuid로 찾아 채운다. 미분류면 NULL',
  categoryClientUuid: '동기화용 부모 참조. 오프라인에서 만든 카테고리는 아직 서버 id가 없다',
  memo: '사용자 자유 입력',
  ...AUDIT_COMMENTS,
})

// ---------------------------------------------------------------------------
// 운동
// ---------------------------------------------------------------------------

export const workouts = pgTable('workouts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(),
  /** 운동 종류 — 사용자 자유 입력 ('벤치프레스') */
  name: text('name').notNull(),
  bodyPart: text('body_part'),
  /** JSONB의 모양은 DB가 막을 수 없다. shared의 workoutSetsSchema로 검증한다 */
  sets: jsonb('sets').$type<WorkoutSet[]>(),
  durationMin: integer('duration_min'),
  intensity: text('intensity'),
  memo: text('memo'),
  ...auditColumns,
}, (t) => [
  uniqueIndex('workouts_client_uuid_uq').on(t.userId, t.clientUuid),
  index('workouts_occurred_idx').on(t.userId, t.occurredOn),
  index('workouts_pull_idx').on(t.userId, t.syncedAt, t.id),
  check('workouts_kind_ck', inCodes(t.kind, WORKOUT_KIND)),
  check('workouts_body_part_ck',
    sql`${t.bodyPart} IS NULL OR ${inCodes(t.bodyPart, BODY_PART)}`),
  check('workouts_intensity_ck',
    sql`${t.intensity} IS NULL OR ${inCodes(t.intensity, INTENSITY)}`),
  check('workouts_duration_ck',
    sql`${t.durationMin} IS NULL OR ${t.durationMin} > 0`),
  // kind에 따라 채워지는 필드가 다르다. zod discriminated union과 같은 규칙을 DB에도 건다.
  check('workouts_shape_ck', sql`
    (${t.kind} = 'STRENGTH' AND ${t.sets} IS NOT NULL AND ${t.durationMin} IS NULL)
    OR (${t.kind} = 'CARDIO' AND ${t.durationMin} IS NOT NULL AND ${t.sets} IS NULL)
    OR ${t.kind} = 'ETC'`),
])

export const workoutsComments = columnComments(workouts, {
  id: '운동 기록 내부 식별자',
  ...SYNC_COMMENTS,
  occurredOn: '기록 대상 날짜',
  kind: '운동 구분 — STRENGTH | CARDIO | ETC. 채워지는 필드가 이 값에 따라 다르다',
  name: '운동 종목. 사용자 자유 입력 (예: 벤치프레스)',
  bodyPart: '부위 — CHEST | BACK | LEGS | SHOULDERS | ARMS | CORE | FULL_BODY',
  sets: '근력 세트 배열. JSONB의 모양은 DB가 막지 못하므로 shared의 zod로 검증한다',
  durationMin: '유산소 지속 시간(분). CARDIO에서만 채운다',
  intensity: '강도 — LOW | MID | HIGH',
  memo: '사용자 자유 입력',
  ...AUDIT_COMMENTS,
})

// ---------------------------------------------------------------------------
// 식사
// ---------------------------------------------------------------------------

export const meals = pgTable('meals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  slot: text('slot').notNull(),
  /** 먹은 것 — 사용자 자유 입력 */
  description: text('description').notNull(),
  portion: text('portion').notNull(),
  /** 수동 입력. 음식명 기반 자동 계산은 범위 밖이다 */
  calories: integer('calories'),
  ...auditColumns,
}, (t) => [
  uniqueIndex('meals_client_uuid_uq').on(t.userId, t.clientUuid),
  index('meals_occurred_idx').on(t.userId, t.occurredOn),
  index('meals_pull_idx').on(t.userId, t.syncedAt, t.id),
  check('meals_slot_ck', inCodes(t.slot, MEAL_SLOT)),
  check('meals_portion_ck', inCodes(t.portion, PORTION)),
  check('meals_calories_ck', sql`${t.calories} IS NULL OR ${t.calories} >= 0`),
])

export const mealsComments = columnComments(meals, {
  id: '식사 기록 내부 식별자',
  ...SYNC_COMMENTS,
  occurredOn: '기록 대상 날짜',
  slot: '끼니 — BREAKFAST | LUNCH | DINNER | SNACK',
  description: '먹은 것. 사용자 자유 입력',
  portion: '양 — LIGHT | NORMAL | HEAVY',
  calories: '열량(kcal). 수동 입력이며 음식명 기반 자동 계산은 하지 않는다',
  ...AUDIT_COMMENTS,
})

// ---------------------------------------------------------------------------
// 일기 — 하루 1건
// ---------------------------------------------------------------------------

/**
 * 하루 1건 제약이 있으므로 `client_uuid`는 랜덤이 아니라
 * `uuidv5(userId + occurredOn)`로 결정론적으로 생성한다. 두 기기가 같은 날
 * 일기를 쓰면 같은 UUID가 나와 유니크 위반 대신 LWW 병합으로 처리된다.
 */
export const journals = pgTable('journals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  content: text('content').notNull(),
  ...auditColumns,
}, (t) => [
  uniqueIndex('journals_client_uuid_uq').on(t.userId, t.clientUuid),
  // 삭제된 일기는 툼스톤으로 남으므로, 같은 날 다시 쓰려면 부분 유니크여야 한다.
  uniqueIndex('journals_day_uq').on(t.userId, t.occurredOn)
    .where(sql`${t.deletedAt} IS NULL`),
  index('journals_pull_idx').on(t.userId, t.syncedAt, t.id),
])

export const journalsComments = columnComments(journals, {
  id: '일기 내부 식별자',
  ...SYNC_COMMENTS,
  clientUuid: '동기화 식별자. 하루 1건이므로 uuidv5(user_id + occurred_on)로 결정론적으로 만든다',
  occurredOn: '기록 대상 날짜. 살아있는 행 기준 하루 1건이다',
  content: '일기 본문. 로그로 출력하지 않는다',
  ...AUDIT_COMMENTS,
})

// ---------------------------------------------------------------------------
// 독서
// ---------------------------------------------------------------------------

/** 책 마스터. 특정 날짜의 기록이 아니므로 `occurred_on`이 없다. */
export const books = pgTable('books', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  title: text('title').notNull(),
  author: text('author'),
  /** 책 내용·줄거리 */
  summary: text('summary'),
  status: text('status').notNull(),
  startedOn: date('started_on', { mode: 'string' }),
  finishedOn: date('finished_on', { mode: 'string' }),
  ...auditColumns,
}, (t) => [
  uniqueIndex('books_client_uuid_uq').on(t.userId, t.clientUuid),
  index('books_status_idx').on(t.userId, t.status),
  index('books_pull_idx').on(t.userId, t.syncedAt, t.id),
  check('books_status_ck', inCodes(t.status, BOOK_STATUS)),
  check('books_period_ck', sql`
    ${t.finishedOn} IS NULL OR ${t.startedOn} IS NULL
    OR ${t.finishedOn} >= ${t.startedOn}`),
])

export const booksComments = columnComments(books, {
  id: '책 내부 식별자',
  ...SYNC_COMMENTS,
  title: '책 제목',
  author: '저자',
  summary: '책 내용·줄거리. 사용자 감상은 book_notes에 쌓인다',
  status: '읽기 상태 — READING | DONE | WISHLIST',
  startedOn: '읽기 시작한 날',
  finishedOn: '다 읽은 날. started_on보다 앞설 수 없다',
  ...AUDIT_COMMENTS,
})

/**
 * 감상평 — 책당 여러 개. `occurred_on`이 있어 오늘 화면과 캘린더에도 나타난다.
 *
 * `book_id` FK는 부모의 '존재'만 보장한다. 부모가 같은 사용자의 것인지는
 * FK가 검사하지 않으므로 서비스 계층에서 반드시 `user_id`로 확인한다.
 */
export const bookNotes = pgTable('book_notes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...syncColumns,
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  bookId: bigint('book_id', { mode: 'number' })
    .notNull()
    .references((): AnyPgColumn => books.id),
  /** 동기화용 부모 참조. 서버가 (user_id, book_client_uuid)로 book_id를 확정한다 */
  bookClientUuid: uuid('book_client_uuid').notNull(),
  content: text('content').notNull(),
  ...auditColumns,
}, (t) => [
  uniqueIndex('book_notes_client_uuid_uq').on(t.userId, t.clientUuid),
  index('book_notes_occurred_idx').on(t.userId, t.occurredOn),
  index('book_notes_book_idx').on(t.userId, t.bookId),
  index('book_notes_pull_idx').on(t.userId, t.syncedAt, t.id),
])

export const bookNotesComments = columnComments(bookNotes, {
  id: '감상평 내부 식별자',
  ...SYNC_COMMENTS,
  occurredOn: '기록 대상 날짜. 오늘 화면과 캘린더에도 나타난다',
  bookId: '책 FK. 존재만 보장하므로 같은 소유자인지는 서비스 계층이 user_id로 확인한다',
  bookClientUuid: '동기화용 부모 참조. 서버가 (user_id, book_client_uuid)로 book_id를 확정한다',
  content: '감상평 본문. 로그로 출력하지 않는다',
  ...AUDIT_COMMENTS,
})

// ---------------------------------------------------------------------------
// 코멘트 집계
// ---------------------------------------------------------------------------

/**
 * 모든 테이블의 `COMMENT ON COLUMN` 문. `db:comments`가 이 목록을 실행한다.
 *
 * 테이블을 새로 만들면 여기에도 추가해야 한다. 빠뜨리면 column-comments 테스트가
 * 잡는다 — 새 테이블만 코멘트 없이 남는 것이 이 목록의 유일한 실패 방식이다.
 */
export const ALL_COLUMN_COMMENTS: readonly string[] = [
  ...codeGroupsComments,
  ...codesComments,
  ...usersComments,
  ...refreshTokensComments,
  ...passwordResetTokensComments,
  ...loginAttemptsComments,
  ...expenseCategoriesComments,
  ...expensesComments,
  ...workoutsComments,
  ...mealsComments,
  ...journalsComments,
  ...booksComments,
  ...bookNotesComments,
]
