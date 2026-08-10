import { z } from 'zod'
import { EXPENSE_KIND, OUTBOX_OP, SYNC_RESULT, type SyncResult } from './codes.ts'

/**
 * push/pull 페이로드의 스키마 버전.
 *
 * PWA는 사용자가 캐시된 구버전을 오래 유지한다. 서버가 더 낮은 버전을 받으면
 * 426으로 막고 Service Worker 갱신을 유도한다. 이 방어가 없으면 구버전이
 * 잘못된 모양의 데이터를 계속 밀어 넣는다.
 *
 * **레코드 모양을 바꾸면 이 값을 올린다.**
 */
export const SCHEMA_VERSION = 1

/** 한 번에 밀어넣을 수 있는 변경 수. 상한이 없으면 요청 하나가 DB를 오래 잡는다. */
export const PUSH_MAX_CHANGES = 500

/** pull 한 페이지의 최대 행 수. */
export const PULL_MAX_LIMIT = 500

/** 동기화 대상 테이블. 서버 테이블명과 정확히 같다. */
export const SYNC_TABLE = ['expense_categories', 'expenses'] as const
export type SyncTable = (typeof SYNC_TABLE)[number]

// ---------------------------------------------------------------------------
// 도메인 페이로드
// ---------------------------------------------------------------------------
//
// 공통 컬럼(user_id, synced_at, created_by, deleted_at ...)은 여기 없다.
// 클라이언트가 보낼 수 있으면 남의 레코드를 쓰거나 pull 커서를 조작할 수 있다.
// 전부 `.strict()`로 두어 모르는 키는 거부한다.

/** 금액은 문자열로 다룬다. 부동소수점을 거치면 12000.00이 깨진다. */
const amountSchema = z.string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, '금액은 소수점 두 자리까지의 0 이상 숫자여야 합니다.')

const occurredOnSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.')

export const expenseCategoryPayloadSchema = z.object({
  name: z.string().trim().min(1).max(50),
}).strict()
export type ExpenseCategoryPayload = z.infer<typeof expenseCategoryPayloadSchema>

export const expensePayloadSchema = z.object({
  occurredOn: occurredOnSchema,
  kind: z.enum(EXPENSE_KIND),
  amount: amountSchema,
  /** 미분류면 null. 부모 카테고리는 서버가 이 UUID로 찾아 category_id를 채운다 */
  categoryClientUuid: z.string().uuid().nullable().default(null),
  memo: z.string().max(500).nullable().default(null),
}).strict()
export type ExpensePayload = z.infer<typeof expensePayloadSchema>

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

export const syncChangeSchema = z.object({
  table: z.enum(SYNC_TABLE),
  clientUuid: z.string().uuid(),
  op: z.enum(OUTBOX_OP),
  /** 클라이언트 시각. 서버가 KST로 정규화한 뒤 LWW 판정에 쓴다 */
  updatedAt: z.string().min(1),
  /** op이 DELETE면 무시된다 */
  payload: z.unknown().optional(),
})
export type SyncChange = z.infer<typeof syncChangeSchema>

export const pushRequestSchema = z.object({
  schemaVersion: z.number().int(),
  changes: z.array(syncChangeSchema).min(1).max(PUSH_MAX_CHANGES),
})
export type PushRequest = z.infer<typeof pushRequestSchema>

/**
 * 항목별 처리 결과 — `codes.ts`의 `SYNC_RESULT`.
 *
 * | status | 뜻 | 클라이언트 |
 * |---|---|---|
 * | `APPLIED` | 저장됨 | 큐에서 제거 |
 * | `STALE` | 서버 값이 더 최신 | 큐에서 제거하고 `serverRow`로 로컬 갱신 |
 * | `CONFLICT` | 부모를 아직 못 찾음 | 큐 유지, 재시도 |
 * | `REJECTED` | 검증 실패 | 큐에서 제거, 사용자에게 알림 |
 */
export const pushStatusSchema = z.enum(SYNC_RESULT)

export interface PushResult {
  clientUuid: string
  table: SyncTable
  status: SyncResult
  /** APPLIED·STALE일 때의 서버 id */
  id?: number
  /** STALE일 때 로컬을 덮어쓸 서버 값 */
  serverRow?: SyncRow
  /** REJECTED·CONFLICT 사유. 사용자에게 보여줄 수 있는 문구여야 한다 */
  reason?: string
}

export interface PushResponse {
  results: PushResult[]
  /** 서버 현재 시각 (KST 벽시계) */
  serverTime: string
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

/** pull로 내려오는 행. 도메인 필드 + 동기화에 필요한 공통 컬럼 */
export interface SyncRow {
  table: SyncTable
  id: number
  clientUuid: string
  occurredOn: string | null
  updatedAt: string
  syncedAt: string
  /** null이 아니면 툼스톤이다 */
  deletedAt: string | null
  payload: Record<string, unknown>
}

export interface PullCursor {
  syncedAt: string
  id: number
}

export interface PullResponse {
  changes: SyncRow[]
  /** 실제로 내려보낸 마지막 행에서 만든다. 없으면 변경이 없었다는 뜻 */
  nextCursor: PullCursor | null
  hasMore: boolean
}

/** 초기 동기화의 시작 커서. `since=0`에 해당한다. */
export const INITIAL_CURSOR: PullCursor = { syncedAt: '1970-01-01 00:00:00.000', id: 0 }
