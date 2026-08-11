import { getTableColumns, getTableName, sql, type SQL, type Table } from 'drizzle-orm'

/**
 * 컬럼 코멘트를 `COMMENT ON COLUMN` 문으로 만든다.
 *
 * drizzle에는 컬럼 코멘트 API가 없어 `pgTable`로 표현할 수 없고 drizzle-kit도
 * 생성하지 않는다. 그렇다고 마이그레이션 SQL에 손으로 박아두면, 컬럼이 추가될 때
 * 코멘트만 조용히 누락된다 — 아무 에러도 나지 않고 한참 뒤 ERD를 열었을 때 드러난다.
 *
 * 그래서 정의를 테이블 옆에 두고, **빠뜨리면 실패하게** 만든다. 키 타입이 컴파일
 * 시점에 막고, 아래 두 검사가 런타임에서 한 번 더 막는다.
 */
export type ColumnCommentMap<T extends Table> =
  Record<keyof T['_']['columns'] & string, string>

/** DDL은 바인드 파라미터를 받지 못한다. 작은따옴표는 겹쳐서 이스케이프한다. */
function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

export function columnComments<T extends Table>(
  table: T,
  comments: ColumnCommentMap<T>,
): string[] {
  const tableName = getTableName(table)
  const columns = getTableColumns(table)
  const given = comments as Record<string, string>

  const unknown = Object.keys(given).filter((key) => !(key in columns))
  if (unknown.length > 0) {
    throw new Error(`${tableName}: 테이블에 없는 컬럼의 코멘트입니다 — ${unknown.join(', ')}`)
  }

  return Object.entries(columns).map(([property, column]) => {
    const comment = given[property]
    if (comment === undefined) {
      throw new Error(`${tableName}: 코멘트가 없는 컬럼입니다 — ${column.name}`)
    }
    return `COMMENT ON COLUMN "${tableName}"."${column.name}" IS ${quote(comment)}`
  })
}

/**
 * 코멘트를 DB에 반영한다. 반영한 문장 수를 돌려준다.
 *
 * `COMMENT ON`은 본래 덮어쓰기라 몇 번 실행해도 결과가 같다. 마이그레이션과
 * 분리해 두었으므로 배포는 `db:migrate` 다음에 `db:comments`를 돌린다.
 *
 * `db`를 구조적 타입으로 받는 이유: 이 모듈이 pool.ts를 import하면 스키마를
 * 읽기만 하는 곳에서도 DB 접속 설정이 필요해진다.
 */
export async function applyColumnComments(
  db: { execute(query: SQL): Promise<unknown> },
  statements: readonly string[],
): Promise<number> {
  for (const statement of statements) {
    await db.execute(sql.raw(statement))
  }
  return statements.length
}
