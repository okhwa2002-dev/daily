import { describe, expect, it } from 'vitest'
import { bookNotePayloadSchema, bookPayloadSchema } from './sync.ts'

const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', status: 'READING', ...over,
})

describe('bookPayloadSchema', () => {
  it('제목과 상태만으로 통과하고 나머지는 null로 채운다', () => {
    const parsed = bookPayloadSchema.parse(book())
    expect(parsed).toEqual({
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
  })

  it('제목의 앞뒤 공백을 없애고 빈 제목은 거부한다', () => {
    expect(bookPayloadSchema.parse(book({ title: '  사피엔스  ' })).title)
      .toBe('사피엔스')
    expect(bookPayloadSchema.safeParse(book({ title: '   ' })).success).toBe(false)
  })

  it('코드값이 아닌 상태를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ status: 'reading' })).success).toBe(false)
    expect(bookPayloadSchema.safeParse(book({ status: '읽는중' })).success).toBe(false)
  })

  // DB의 books_period_ck를 여기서도 막는다. 통과시키면 INSERT가 DB 에러로
  // 죽고, 그 500은 REJECTED가 아니라 재시도 대상이라 큐가 영영 막힌다.
  it('완독일이 시작일보다 앞서면 거부한다', () => {
    const result = bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-10', finishedOn: '2026-08-09' }),
    )
    expect(result.success).toBe(false)
  })

  it('한쪽이 null이면 기간 검사를 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: null, finishedOn: '2026-08-09' }),
    ).success).toBe(true)
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: null }),
    ).success).toBe(true)
  })

  it('같은 날 시작하고 끝낸 것은 통과한다', () => {
    expect(bookPayloadSchema.safeParse(
      book({ startedOn: '2026-08-09', finishedOn: '2026-08-09' }),
    ).success).toBe(true)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookPayloadSchema.safeParse(book({ userId: 2 })).success).toBe(false)
  })
})

describe('bookNotePayloadSchema', () => {
  const note = (over: Record<string, unknown> = {}) => ({
    occurredOn: '2026-08-11',
    bookClientUuid: '00000000-0000-4000-8000-000000000001',
    content: '3부가 인상 깊다', ...over,
  })

  it('세 필드를 모두 요구한다', () => {
    expect(bookNotePayloadSchema.safeParse(note()).success).toBe(true)
  })

  // 부모는 선택 항목이 아니다. null을 허용하면 서버가 book_id를 못 채우고,
  // NOT NULL 위반이 500으로 나와 큐가 막힌다.
  it('부모 책 UUID가 null이면 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookClientUuid: null })).success)
      .toBe(false)
  })

  it('빈 본문을 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ content: '   ' })).success).toBe(false)
  })

  it('모르는 키를 거부한다', () => {
    expect(bookNotePayloadSchema.safeParse(note({ bookId: 3 })).success).toBe(false)
  })
})
