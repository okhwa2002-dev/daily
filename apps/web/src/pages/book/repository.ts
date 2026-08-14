import type { BookStatus } from '@daily/shared'
import { db, live, type LocalBook, type LocalBookNote } from '../../db/index.ts'
import { enqueue, localNow } from '../../sync/outbox.ts'

/**
 * 화면이 독서 데이터에 닿는 유일한 통로.
 *
 * 읽기·쓰기 모두 로컬 Dexie를 거친다. 화면 컴포넌트는 API를 직접 호출하지
 * 않는다 — 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너진다.
 */

export interface BookInput {
  title: string
  author: string | null
  summary: string | null
  status: BookStatus
  startedOn: string | null
  finishedOn: string | null
  /** 장르 코드값 (codes의 BOOK_GENRE 그룹). 미지정이면 null */
  genre: string | null
}

export interface BookNoteInput {
  occurredOn: string
  bookClientUuid: string
  content: string
}

function newUuid(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export async function listBooks(
  userId: number,
  status: BookStatus | 'ALL',
): Promise<LocalBook[]> {
  const rows = status === 'ALL'
    ? await db.books.where('userId').equals(userId).toArray()
    : await db.books.where('[userId+status]').equals([userId, status]).toArray()
  // 최근에 손댄 책이 위로 온다.
  return live(rows).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getBook(
  userId: number,
  clientUuid: string,
): Promise<LocalBook | undefined> {
  const row = await db.books.get(clientUuid)
  if (!row || row.userId !== userId || row.deletedAt !== null) return undefined
  return row
}

export async function listNotesByBook(
  userId: number,
  bookClientUuid: string,
): Promise<LocalBookNote[]> {
  const rows = await db.bookNotes.where('bookClientUuid').equals(bookClientUuid).toArray()
  return live(rows.filter((row) => row.userId === userId))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
}

/** 목록 화면의 "감상평 N" 배지용. 책 UUID → 개수 */
export async function countNotesByBook(userId: number): Promise<Map<string, number>> {
  const rows = live(await db.bookNotes.where('userId').equals(userId).toArray())
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.bookClientUuid, (counts.get(row.bookClientUuid) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 책을 저장하고 같은 트랜잭션에서 큐에 넣는다.
 *
 * 레코드만 쓰고 큐 적재가 실패하면 그 변경은 이 기기에만 남아 영영 서버로
 * 가지 않는다. 사용자는 다른 기기에서 기록이 비어 있는 것을 나중에 발견한다.
 */
export async function saveBook(
  userId: number,
  input: BookInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.books, db.outbox, async () => {
    const existing = await db.books.get(clientUuid)
    await db.books.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      title: input.title,
      author: input.author,
      summary: input.summary,
      status: input.status,
      startedOn: input.startedOn,
      finishedOn: input.finishedOn,
      genre: input.genre,
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'books',
      clientUuid,
      op: 'UPSERT',
      payload: {
        title: input.title,
        author: input.author,
        summary: input.summary,
        status: input.status,
        startedOn: input.startedOn,
        finishedOn: input.finishedOn,
        genre: input.genre,
      },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

/**
 * 책에 툼스톤을 남긴다.
 *
 * **감상평은 건드리지 않는다.** 캐스케이드 소프트 삭제를 하면 감상평 N건이
 * 한꺼번에 큐에 쌓이고, 되살릴 때 어떤 감상평이 그 삭제로 지워진 것인지
 * 구분할 수 없다. 삭제된 책은 목록에 뜨지 않으므로 감상평으로 가는 경로도 없다.
 */
export async function deleteBook(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.books, db.outbox, async () => {
    const existing = await db.books.get(clientUuid)
    if (!existing || existing.userId !== userId) return

    await db.books.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'books',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}

export async function saveNote(
  userId: number,
  input: BookNoteInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.bookNotes, db.outbox, async () => {
    const existing = await db.bookNotes.get(clientUuid)
    await db.bookNotes.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      occurredOn: input.occurredOn,
      bookClientUuid: input.bookClientUuid,
      content: input.content,
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'book_notes',
      clientUuid,
      op: 'UPSERT',
      payload: {
        occurredOn: input.occurredOn,
        bookClientUuid: input.bookClientUuid,
        content: input.content,
      },
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteNote(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.bookNotes, db.outbox, async () => {
    const existing = await db.bookNotes.get(clientUuid)
    if (!existing || existing.userId !== userId) return

    await db.bookNotes.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'book_notes',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}
