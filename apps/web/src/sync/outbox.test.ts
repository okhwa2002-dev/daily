import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/index.ts'
import { enqueue, pendingCount, removeFromQueue, takeBatch } from './outbox.ts'

const UUID_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const UUID_B = 'bbbbbbbb-0000-4000-8000-000000000002'

beforeEach(async () => { await db.outbox.clear() })

const upsert = (clientUuid: string, payload: unknown, updatedAt: string) =>
  enqueue({
    table: 'expenses', clientUuid, op: 'UPSERT', payload, updatedAt, everSynced: true,
  })

describe('아웃박스 compaction', () => {
  it('같은 레코드의 UPSERT가 이어지면 마지막 것만 남는다', async () => {
    await upsert(UUID_A, { amount: '1000' }, '2026-08-10 10:00:00.000')
    await upsert(UUID_A, { amount: '2000' }, '2026-08-10 10:00:01.000')
    await upsert(UUID_A, { amount: '3000' }, '2026-08-10 10:00:02.000')

    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.payload).toEqual({ amount: '3000' })
  })

  it('UPSERT 뒤의 DELETE는 DELETE만 남긴다', async () => {
    await upsert(UUID_A, { amount: '1000' }, '2026-08-10 10:00:00.000')
    await enqueue({
      table: 'expenses', clientUuid: UUID_A, op: 'DELETE',
      updatedAt: '2026-08-10 10:00:01.000', everSynced: true,
    })

    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.op).toBe('DELETE')
  })

  it('서버가 모르는 레코드를 지우면 큐에서 둘 다 사라진다', async () => {
    await enqueue({
      table: 'expenses', clientUuid: UUID_A, op: 'UPSERT',
      payload: { amount: '1000' }, updatedAt: '2026-08-10 10:00:00.000',
      everSynced: false,
    })
    await enqueue({
      table: 'expenses', clientUuid: UUID_A, op: 'DELETE',
      updatedAt: '2026-08-10 10:00:01.000', everSynced: false,
    })

    // 서버가 모르는 레코드의 툼스톤을 보낼 이유가 없다.
    expect(await pendingCount()).toBe(0)
  })

  it('다른 레코드는 서로 접히지 않는다', async () => {
    await upsert(UUID_A, { amount: '1000' }, '2026-08-10 10:00:00.000')
    await upsert(UUID_B, { amount: '2000' }, '2026-08-10 10:00:01.000')

    expect(await pendingCount()).toBe(2)
  })

  it('compaction 후에도 seq는 가장 오래된 값을 유지한다', async () => {
    // 부모가 먼저 큐에 들어간 뒤 자식이 들어오고, 그다음 부모가 수정되는 상황.
    // 부모가 새 seq를 받으면 자식보다 뒤로 밀려 서버가 부모를 못 찾는다.
    await upsert(UUID_A, { name: '식비' }, '2026-08-10 10:00:00.000')
    await upsert(UUID_B, { amount: '1000' }, '2026-08-10 10:00:01.000')
    await upsert(UUID_A, { name: '식비/외식' }, '2026-08-10 10:00:02.000')

    const queue = await takeBatch(10)
    expect(queue.map((row) => row.clientUuid)).toEqual([UUID_A, UUID_B])
    expect(queue[0]?.payload).toEqual({ name: '식비/외식' })
  })

  it('seq 순서대로 배치를 꺼낸다', async () => {
    await upsert(UUID_A, {}, '2026-08-10 10:00:00.000')
    await upsert(UUID_B, {}, '2026-08-10 10:00:01.000')

    const batch = await takeBatch(1)
    expect(batch).toHaveLength(1)
    expect(batch[0]?.clientUuid).toBe(UUID_A)
  })

  it('큐에서 제거하면 대기 수가 줄어든다', async () => {
    await upsert(UUID_A, {}, '2026-08-10 10:00:00.000')
    const [row] = await takeBatch(1)
    await removeFromQueue([row!.seq])
    expect(await pendingCount()).toBe(0)
  })
})
