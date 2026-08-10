import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from './pool.ts'
import { expenses, users } from './schema.ts'
import { liveOwnedBy, ownedBy } from './ownership.ts'
import { dbNow } from './time.ts'
import { resetDb, testLoginId } from './testing.ts'

beforeEach(async () => { await resetDb() })
afterAll(async () => { await pool.end() })

const TODAY = '2026-08-10'
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function makeUser(email: string): Promise<number> {
  const now = dbNow()
  const [row] = await db.insert(users).values({
    loginId: testLoginId(email), email, passwordHash: 'h', status: 'ACTIVE',
    createdAt: now, createdBy: 0, updatedAt: now, updatedBy: 0,
  }).returning()
  return row!.id
}

async function makeExpense(userId: number, uuid: number, amount: string, deleted = false) {
  const now = dbNow()
  const [row] = await db.insert(expenses).values({
    clientUuid: UUID(uuid), userId, syncedAt: now,
    occurredOn: TODAY, kind: 'EXPENSE', amount,
    createdAt: now, createdBy: userId, updatedAt: now, updatedBy: userId,
    deletedAt: deleted ? now : null, deletedBy: deleted ? userId : null,
  }).returning()
  return row!
}

/** A는 살아있는 기록 1건 + 툼스톤 1건, B는 살아있는 기록 1건 */
async function fixture() {
  const a = await makeUser('a@example.com')
  const b = await makeUser('b@example.com')
  await makeExpense(a, 1, '1000')
  await makeExpense(a, 2, '2000', true)
  await makeExpense(b, 3, '9999')
  return { a, b }
}

describe('ownedBy', () => {
  it('자기 기록만 반환한다 — 툼스톤 포함', async () => {
    const { a } = await fixture()
    const rows = await db.select().from(expenses).where(ownedBy(expenses, a))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.userId === a)).toBe(true)
  })

  it('남의 기록은 client_uuid를 정확히 알아도 반환하지 않는다', async () => {
    const { a } = await fixture()
    const rows = await db.select().from(expenses)
      .where(ownedBy(expenses, a, eq(expenses.clientUuid, UUID(3))))
    expect(rows).toHaveLength(0)
  })

  it('추가 조건과 AND로 결합한다', async () => {
    const { a } = await fixture()
    const rows = await db.select().from(expenses)
      .where(ownedBy(expenses, a, eq(expenses.clientUuid, UUID(1))))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe('1000.00')
  })
})

describe('liveOwnedBy', () => {
  it('툼스톤을 제외한다', async () => {
    const { a } = await fixture()
    const rows = await db.select().from(expenses).where(liveOwnedBy(expenses, a))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.clientUuid).toBe(UUID(1))
  })

  it('남의 살아있는 기록도 반환하지 않는다', async () => {
    const { a } = await fixture()
    const rows = await db.select().from(expenses).where(liveOwnedBy(expenses, a))
    expect(rows.every((r) => r.userId === a)).toBe(true)
  })
})

describe('교차 계정 차단 — 수정·삭제', () => {
  it('남의 기록을 수정할 수 없다', async () => {
    const { a, b } = await fixture()
    const updated = await db.update(expenses)
      .set({ amount: '1.00' })
      // B가 A의 레코드를 노리고 client_uuid를 알아냈다고 가정한다.
      .where(ownedBy(expenses, b, eq(expenses.clientUuid, UUID(1))))
      .returning()

    expect(updated).toHaveLength(0)
    const [mine] = await db.select().from(expenses)
      .where(ownedBy(expenses, a, eq(expenses.clientUuid, UUID(1))))
    expect(mine?.amount).toBe('1000.00')
  })

  it('남의 기록을 소프트 삭제할 수 없다', async () => {
    const { a, b } = await fixture()
    const now = dbNow()
    const deleted = await db.update(expenses)
      .set({ deletedAt: now, deletedBy: b, updatedAt: now, updatedBy: b })
      .where(ownedBy(expenses, b, eq(expenses.clientUuid, UUID(1))))
      .returning()

    expect(deleted).toHaveLength(0)
    const live = await db.select().from(expenses).where(liveOwnedBy(expenses, a))
    expect(live).toHaveLength(1)
  })

  it('같은 client_uuid를 가진 두 사용자의 기록이 서로 섞이지 않는다', async () => {
    const a = await makeUser('a@example.com')
    const b = await makeUser('b@example.com')
    await makeExpense(a, 7, '100')
    await makeExpense(b, 7, '200')

    const [rowA] = await db.select().from(expenses)
      .where(ownedBy(expenses, a, eq(expenses.clientUuid, UUID(7))))
    const [rowB] = await db.select().from(expenses)
      .where(ownedBy(expenses, b, eq(expenses.clientUuid, UUID(7))))

    expect(rowA?.amount).toBe('100.00')
    expect(rowB?.amount).toBe('200.00')
  })
})
