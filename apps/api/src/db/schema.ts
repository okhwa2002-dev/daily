import {
  bigint, bigserial, index, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core'

/** 모든 테이블이 공유하는 감사 컬럼. `_at`에는 반드시 `_by`가 따라붙는다. */
const auditColumns = {
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  createdBy: bigint('created_by', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
  updatedBy: bigint('updated_by', { mode: 'number' }).notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  deletedBy: bigint('deleted_by', { mode: 'number' }),
}

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { mode: 'string' }),
  status: text('status').notNull().default('ACTIVE'),
  deletionRequestedAt: timestamp('deletion_requested_at', { mode: 'string' }),
  ...auditColumns,
}, (t) => [uniqueIndex('users_email_uq').on(t.email)])

export const refreshTokens = pgTable('refresh_tokens', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
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
  ...auditColumns,
}, (t) => [uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash)])

/**
 * 인증 '전' 이벤트를 기록하므로 감사 컬럼(`_by`)을 갖지 않는다.
 * 없는 계정으로 시도한 경우 행위자 ID가 존재하지 않기 때문이다. 대신 email과 ip를 남긴다.
 */
export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  ip: text('ip').notNull(),
  succeeded: text('succeeded').notNull(), // 'Y' | 'N'
  attemptedAt: timestamp('attempted_at', { mode: 'string' }).notNull(),
}, (t) => [index('login_attempts_email_idx').on(t.email, t.attemptedAt)])
