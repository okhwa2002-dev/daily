import type { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import {
  bookNotePayloadSchema, bookPayloadSchema, CODE_GROUP,
  expenseCategoryPayloadSchema, expensePayloadSchema,
  type BookNotePayload, type BookPayload,
  type ExpenseCategoryPayload, type ExpensePayload, type SyncTable,
} from '@daily/shared'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { bookNotes, books, codes, expenseCategories, expenses } from '../db/schema.ts'
import type { OwnedTable } from '../db/ownership.ts'
import { db } from '../db/pool.ts'

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
   * DB를 봐야 하는 검증. 통과면 `null`, 실패면 사용자에게 보여줄 사유.
   *
   * 실패는 **REJECTED**다 — CONFLICT가 아니다. CONFLICT는 "부모가 아직
   * 안 왔다"이고 재시도로 풀리지만, 여기서 걸리는 값은 재시도해도 계속 틀리다.
   * 큐에 남기면 그 항목이 영원히 빠지지 않는다.
   *
   * zod로 막을 수 없는 것만 여기 온다. 값 집합이 DB에 있는 공통코드가 그렇다.
   */
  validate?(payload: TPayload): Promise<string | null>
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
 * 나머지 도메인(운동·식사·일기)은 화면이 만들어지는 시점에 추가한다.
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
}
