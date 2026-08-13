import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { takeBatch } from '../../sync/outbox.ts'
import {
  countNotesByBook, deleteBook, deleteNote, getBook, listBooks, listNotesByBook,
  saveBook, saveNote,
} from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-11'

const book = (over: Record<string, unknown> = {}) => ({
  title: '사피엔스', author: null, summary: null,
  status: 'READING' as const, startedOn: null, finishedOn: null,
  genre: null, ...over,
})

beforeEach(async () => {
  await db.books.clear()
  await db.bookNotes.clear()
  await db.outbox.clear()
})

describe('책 저장', () => {
  it('로컬에 저장하고 같은 동작으로 큐에 넣는다', async () => {
    const uuid = await saveBook(USER, book())

    expect(await listBooks(USER, 'ALL')).toHaveLength(1)
    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.table).toBe('books')
    expect(queue[0]?.clientUuid).toBe(uuid)
  })

  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveBook(USER, book())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort())
      .toEqual(['author', 'finishedOn', 'genre', 'startedOn', 'status', 'summary', 'title'])
  })

  it('장르를 저장하고 읽어온다', async () => {
    const uuid = await saveBook(USER, book({ genre: 'NOVEL' }))
    expect((await getBook(USER, uuid))?.genre).toBe('NOVEL')
  })

  it('미지정으로 저장하면 장르가 null이다', async () => {
    const uuid = await saveBook(USER, book())
    expect((await getBook(USER, uuid))?.genre).toBeNull()
    const [row] = await takeBatch(1)
    expect((row!.payload as { genre: unknown }).genre).toBeNull()
  })

  it('같은 clientUuid로 다시 저장하면 수정이다', async () => {
    const uuid = await saveBook(USER, book({ status: 'READING' }))
    await saveBook(USER, book({ status: 'DONE' }), uuid)

    expect((await getBook(USER, uuid))?.status).toBe('DONE')
    expect(await takeBatch(10)).toHaveLength(1)
  })

  it('다른 사용자의 책은 보이지 않는다', async () => {
    await saveBook(USER, book())
    await saveBook(OTHER, book())
    expect(await listBooks(USER, 'ALL')).toHaveLength(1)
  })

  it('상태로 거른다', async () => {
    await saveBook(USER, book({ status: 'READING' }))
    await saveBook(USER, book({ status: 'DONE' }))

    expect(await listBooks(USER, 'READING')).toHaveLength(1)
    expect(await listBooks(USER, 'ALL')).toHaveLength(2)
  })
})

describe('책 삭제', () => {
  it('물리 삭제하지 않고 툼스톤을 남긴다', async () => {
    const uuid = await saveBook(USER, book())
    await db.books.update(uuid, { serverId: 7 })
    await deleteBook(USER, uuid)

    expect(await listBooks(USER, 'ALL')).toHaveLength(0)
    expect((await db.books.get(uuid))?.deletedAt).not.toBeNull()
    const [row] = await takeBatch(1)
    expect(row?.op).toBe('DELETE')
  })

  it('남의 책은 지우지 않는다', async () => {
    const uuid = await saveBook(OTHER, book())
    await deleteBook(USER, uuid)
    expect((await db.books.get(uuid))?.deletedAt).toBeNull()
  })

  // 캐스케이드 소프트 삭제를 하면 감상평 N건이 한꺼번에 큐에 쌓이고,
  // 되살릴 때 어떤 감상평이 그 삭제로 지워진 것인지 구분할 수 없다.
  it('감상평은 함께 지우지 않는다', async () => {
    const bookUuid = await saveBook(USER, book())
    const noteUuid = await saveNote(USER, {
      occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다',
    })

    await deleteBook(USER, bookUuid)

    expect((await db.bookNotes.get(noteUuid))?.deletedAt).toBeNull()
  })
})

describe('감상평', () => {
  it('책보다 뒤 seq를 받아 부모가 먼저 전송된다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다' })

    const queue = await takeBatch(10)
    expect(queue.map((r) => r.table)).toEqual(['books', 'book_notes'])
  })

  // enqueue의 compaction이 가장 오래된 seq를 유지하는 것에 기대는 동작이다.
  // 새 seq를 받으면 자식이 부모보다 먼저 나가 서버가 CONFLICT를 반복한다.
  it('책을 수정해도 여전히 감상평보다 앞선다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다' })
    await saveBook(USER, book({ title: '사피엔스(개정판)' }), bookUuid)

    const queue = await takeBatch(10)
    expect(queue.map((r) => r.table)).toEqual(['books', 'book_notes'])
  })

  it('부모 책으로 감상평을 찾고 최근 날짜가 앞에 온다', async () => {
    const bookUuid = await saveBook(USER, book())
    await saveNote(USER, { occurredOn: '2026-08-09', bookClientUuid: bookUuid, content: '앞' })
    await saveNote(USER, { occurredOn: '2026-08-11', bookClientUuid: bookUuid, content: '뒤' })

    const notes = await listNotesByBook(USER, bookUuid)
    expect(notes.map((n) => n.content)).toEqual(['뒤', '앞'])
  })

  it('책별 감상평 수를 센다', async () => {
    const a = await saveBook(USER, book({ title: 'A' }))
    const b = await saveBook(USER, book({ title: 'B' }))
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: a, content: '1' })
    await saveNote(USER, { occurredOn: TODAY, bookClientUuid: a, content: '2' })

    const counts = await countNotesByBook(USER)
    expect(counts.get(a)).toBe(2)
    expect(counts.get(b)).toBeUndefined()
  })

  it('삭제한 감상평은 세지 않는다', async () => {
    const bookUuid = await saveBook(USER, book())
    const noteUuid = await saveNote(USER, {
      occurredOn: TODAY, bookClientUuid: bookUuid, content: '좋다',
    })
    await deleteNote(USER, noteUuid)

    expect(await listNotesByBook(USER, bookUuid)).toHaveLength(0)
    expect((await countNotesByBook(USER)).get(bookUuid)).toBeUndefined()
  })
})
