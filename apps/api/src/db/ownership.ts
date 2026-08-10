import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * 소유권 조건이 반드시 붙는 테이블의 최소 모양.
 *
 * `user_id`와 `deleted_at`을 가진 테이블만 이 헬퍼를 통과한다. 타입 수준에서
 * 강제해 두면, 컬럼이 없는 테이블에 실수로 쓰는 순간 컴파일이 깨진다.
 */
export interface OwnedTable {
  userId: AnyPgColumn
  deletedAt: AnyPgColumn
}

/**
 * `user_id = :userId` 조건을 강제로 끼운 where 절을 만든다.
 *
 * 조회·수정·삭제 쿼리에서 이 조건이 빠지면 남의 기록이 새어나간다. 조건을 매번
 * 손으로 쓰면 언젠가 한 곳에서 빠지고, 그 한 곳이 사고가 된다. `userId`는
 * 반드시 인증 미들웨어가 주입한 `req.userId`여야 한다 — 요청 본문이나
 * 쿼리스트링의 값을 넘기지 않는다.
 *
 * 툼스톤까지 포함해야 하는 동기화 pull 전용이다. 화면 조회에는 {@link liveOwnedBy}를 쓴다.
 */
export function ownedBy(
  table: OwnedTable,
  userId: number,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(eq(table.userId, userId), ...extra)!
}

/**
 * {@link ownedBy} + `deleted_at IS NULL`.
 *
 * 화면 조회의 기본값이다. 소프트 삭제한 레코드는 툼스톤으로 남으므로,
 * 이 조건을 빠뜨리면 사용자가 지운 기록이 화면에 다시 나타난다.
 */
export function liveOwnedBy(
  table: OwnedTable,
  userId: number,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(eq(table.userId, userId), isNull(table.deletedAt), ...extra)!
}
