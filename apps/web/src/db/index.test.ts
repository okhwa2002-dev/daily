import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index.ts'

beforeEach(async () => {
  await db.outbox.clear()
  await db.meta.clear()
  await db.books.clear()
  await db.bookNotes.clear()
})

describe('로컬 DB', () => {
  it('아웃박스에 항목을 넣으면 seq가 증가한다', async () => {
    const first = await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-1', op: 'UPSERT',
      payload: { amount: '1000' }, updatedAt: '2026-08-06 10:00:00.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:00.000',
    })
    const second = await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-2', op: 'DELETE',
      payload: null, updatedAt: '2026-08-06 10:00:01.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:01.000',
    })

    expect(second).toBeGreaterThan(first)
  })

  it('clientUuid로 아웃박스 항목을 찾는다', async () => {
    await db.outbox.add({
      table: 'expenses', clientUuid: 'uuid-1', op: 'UPSERT',
      payload: {}, updatedAt: '2026-08-06 10:00:00.000',
      tryCount: 0, lastError: null, queuedAt: '2026-08-06 10:00:00.000',
    })

    const found = await db.outbox.where('clientUuid').equals('uuid-1').toArray()
    expect(found).toHaveLength(1)
    expect(found[0]?.op).toBe('UPSERT')
  })

  it('meta는 key로 값을 저장하고 읽는다', async () => {
    await db.meta.put({ key: 'lastPulledSyncedAt', value: '2026-08-06 09:00:00.000' })
    const row = await db.meta.get('lastPulledSyncedAt')
    expect(row?.value).toBe('2026-08-06 09:00:00.000')
  })
})

describe('version 3 — 독서', () => {
  it('책과 감상평 스토어를 연다', async () => {
    await db.open()
    expect(db.tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['books', 'bookNotes']),
    )
  })

  it('상태별 조회 인덱스를 갖는다', async () => {
    await db.books.put({
      clientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      userId: 1, serverId: null,
      title: '사피엔스', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
      updatedAt: '2026-08-11 10:00:00.000', deletedAt: null,
    })
    const rows = await db.books.where('[userId+status]').equals([1, 'READING']).toArray()
    expect(rows).toHaveLength(1)
  })

  it('감상평을 부모 책으로 찾는다', async () => {
    const bookUuid = 'aaaaaaaa-0000-4000-8000-000000000001'
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: 1, serverId: null,
      occurredOn: '2026-08-11', bookClientUuid: bookUuid, content: '좋다',
      updatedAt: '2026-08-11 10:00:00.000', deletedAt: null,
    })
    const rows = await db.bookNotes.where('bookClientUuid').equals(bookUuid).toArray()
    expect(rows).toHaveLength(1)
  })
})
