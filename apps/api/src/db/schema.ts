import { sql, type SQL } from 'drizzle-orm'
import {
  bigint, bigserial, check, date, index, integer, jsonb, numeric, pgTable,
  text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from 'drizzle-orm/pg-core'
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
