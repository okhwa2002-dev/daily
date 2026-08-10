import type { z } from 'zod'
import {
  expenseCategoryPayloadSchema, expensePayloadSchema,
  type ExpenseCategoryPayload, type ExpensePayload, type SyncTable,
} from '@daily/shared'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { expenseCategories, expenses } from '../db/schema.ts'
import type { OwnedTable } from '../db/ownership.ts'

/** 컬럼명 → 값. 동기화 엔진이 테이블을 모른 채 다루는 단위다. */
export type ColumnValues = Record<string, unknown>

/** 동기화 엔진이 요구하는 컬럼을 가진 테이블. */
export type SyncableTable = PgTable & OwnedTable & {
  id: AnyPgColumn
  clientUuid: AnyPgColumn
  updatedAt: AnyPgColumn
  syncedAt: AnyPgColumn
}

/**
 * 부모-자식 동기화 정의.
 *
 * 오프라인에서 부모를 만들고 곧바로 자식을 만들면, 자식을 보낼 때 부모의 서버
 * `id`가 아직 없다. 서버가 `(user_id, client_uuid)`로 부모를 찾아 FK를 채운다.
 */
export interface ParentRef {
  /** 페이로드에서 부모 UUID가 들어 있는 필드명 */
  uuidField: string
  parentTable: SyncableTable
  /** false면 부모 UUID가 null이어도 된다 (지출의 미분류) */
  required: boolean
}

export interface SyncTableDef<TPayload = unknown> {
  table: SyncableTable
  /**
   * 도메인 필드만 받는다. 공통 컬럼은 서버가 채운다.
   *
   * 입력 타입을 `unknown`으로 열어 두는 이유: `.default()`가 붙은 필드는 입력에서
   * 생략 가능해 입력·출력 타입이 갈라진다. 여기서 고정해야 하는 것은 파싱 결과뿐이다.
   */
  payload: z.ZodType<TPayload, z.ZodTypeDef, unknown>
  /** 기록 테이블이면 true. 마스터 데이터(카테고리)는 false */
  hasOccurredOn: boolean
  parent?: ParentRef
  /**
   * 검증된 페이로드 → 도메인 컬럼.
   *
   * 공통 컬럼(user_id, synced_at, *_by, deleted_at)은 **여기서 만들지 않는다.**
   * 전부 서버가 채운다. 클라이언트 값이 섞여 들어올 경로를 남기지 않는 것이 목적이다.
   */
  toColumns(payload: TPayload, parentId: number | null): ColumnValues
  /** DB row → pull 페이로드. `toColumns`의 역방향이다 */
  toPayload(row: ColumnValues): ColumnValues
}

/**
 * 항목별 페이로드 타입을 유지한 채 균일한 맵에 담기 위한 헬퍼.
 *
 * 각 항목 안에서는 `toColumns`가 자기 페이로드 타입으로 검사되고, 밖에서는
 * 엔진이 테이블을 모른 채 호출할 수 있다. 이 캐스팅이 유일한 접점이다.
 */
function define<T>(d: SyncTableDef<T>): SyncTableDef<AnyPayload> {
  return d as unknown as SyncTableDef<AnyPayload>
}

/** 엔진이 다루는 "검증은 끝났지만 모양은 모르는" 페이로드. */
export type AnyPayload = Record<string, unknown>

/**
 * 동기화 대상 테이블 정의.
 *
 * 테이블별 분기를 라우트에 흩뿌리면 테이블을 추가할 때 push·pull·검증 세 곳을
 * 고쳐야 하고, 그중 하나를 빠뜨리는 것이 1단계에서 반복된 실패 방식이었다.
 * 여기 한 항목을 추가하면 세 곳이 함께 따라온다.
 *
 * **2단계 범위는 지출뿐이다.** 나머지 5개 테이블은 엔진이 검증된 뒤에 추가한다.
 */
export const SYNC_REGISTRY: { [K in SyncTable]: SyncTableDef<AnyPayload> } = {
  expense_categories: define<ExpenseCategoryPayload>({
    table: expenseCategories,
    payload: expenseCategoryPayloadSchema,
    hasOccurredOn: false,
    toColumns: (p) => ({ name: p.name }),
    toPayload: (r) => ({ name: r.name }),
  }),
  expenses: define<ExpensePayload>({
    table: expenses,
    payload: expensePayloadSchema,
    hasOccurredOn: true,
    parent: {
      uuidField: 'categoryClientUuid',
      parentTable: expenseCategories,
      // 카테고리는 선택 항목이다. null이면 미분류로 저장한다.
      required: false,
    },
    toColumns: (p: ExpensePayload, parentId) => ({
      occurredOn: p.occurredOn,
      kind: p.kind,
      amount: p.amount,
      categoryId: parentId,
      categoryClientUuid: p.categoryClientUuid,
      memo: p.memo,
    }),
    toPayload: (r) => ({
      occurredOn: r.occurredOn,
      kind: r.kind,
      amount: r.amount,
      categoryClientUuid: r.categoryClientUuid,
      memo: r.memo,
    }),
  }),
}
