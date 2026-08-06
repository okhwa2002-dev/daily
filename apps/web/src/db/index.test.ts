import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './index.ts'

beforeEach(async () => {
  await db.outbox.clear()
  await db.meta.clear()
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
