import { getTableColumns, getTableName, is, Table } from 'drizzle-orm'
import { bigserial, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { columnComments } from './column-comments.ts'
import * as schema from './schema.ts'

const samples = pgTable('samples', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  loginId: text('login_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
})

describe('columnComments', () => {
  it('컬럼마다 실제 DB 컬럼명으로 COMMENT 문을 만든다', () => {
    // 프로퍼티명은 camelCase, DB 컬럼명은 snake_case다. 문장에는 후자가 들어가야 한다.
    expect(columnComments(samples, {
      id: '내부 식별자',
      loginId: '로그인 아이디',
      createdAt: '등록 일시',
    })).toEqual([
      `COMMENT ON COLUMN "samples"."id" IS '내부 식별자'`,
      `COMMENT ON COLUMN "samples"."login_id" IS '로그인 아이디'`,
      `COMMENT ON COLUMN "samples"."created_at" IS '등록 일시'`,
    ])
  })

  it('작은따옴표를 이스케이프한다', () => {
    // DDL은 바인드 파라미터를 받지 못한다. 이스케이프를 빠뜨리면 문장이 깨진다.
    const [stmt] = columnComments(samples, {
      id: `사용자가 'Y'로 표기한 값`,
      loginId: '-',
      createdAt: '-',
    })

    expect(stmt).toBe(`COMMENT ON COLUMN "samples"."id" IS '사용자가 ''Y''로 표기한 값'`)
  })

  it('코멘트가 빠진 컬럼이 있으면 던진다', () => {
    // 타입이 먼저 막지만, 컬럼을 추가하고 코멘트를 빠뜨리는 것이 이 장치가
    // 막으려는 유일한 실패다. 런타임에서도 조용히 넘어가지 않게 한다.
    const incomplete = { id: '내부 식별자', loginId: '로그인 아이디' } as never

    expect(() => columnComments(samples, incomplete))
      .toThrow(/samples.*created_at/)
  })

  it('테이블에 없는 컬럼을 적으면 던진다', () => {
    const unknown = {
      id: '-', loginId: '-', createdAt: '-', gone: '사라진 컬럼',
    } as never

    expect(() => columnComments(samples, unknown)).toThrow(/samples.*gone/)
  })
})

describe('스키마 컬럼 코멘트', () => {
  // schema 모듈에는 테이블 외에 코멘트 배열도 export되어 있다. unknown을 거쳐야
  // 타입 가드가 그 합집합을 좁힐 수 있다.
  const tables = (Object.values(schema) as unknown[])
    .filter((v): v is Table => is(v, Table))

  it('스키마의 테이블을 하나도 빠뜨리지 않는다', () => {
    // 테이블을 새로 만들고 코멘트를 안 붙이면 여기서 걸린다. 이 검사가 없으면
    // 새 테이블만 코멘트 없이 남고 아무도 눈치채지 못한다.
    const covered = new Set(
      schema.ALL_COLUMN_COMMENTS.map((s) => /^COMMENT ON COLUMN "([^"]+)"/.exec(s)?.[1]),
    )

    expect([...tables.map(getTableName)].filter((n) => !covered.has(n))).toEqual([])
  })

  it('테이블마다 컬럼 수만큼 코멘트를 만든다', () => {
    for (const table of tables) {
      const name = getTableName(table)
      const made = schema.ALL_COLUMN_COMMENTS
        .filter((s) => s.startsWith(`COMMENT ON COLUMN "${name}".`))

      expect(made, name).toHaveLength(Object.keys(getTableColumns(table)).length)
    }
  })
})
