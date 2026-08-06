import Dexie, { type EntityTable } from 'dexie'
import type { OutboxOp } from '@daily/shared'

export interface OutboxRow {
  seq: number
  /** 서버 테이블명 (예: 'expenses') */
  table: string
  clientUuid: string
  op: OutboxOp
  payload: unknown
  /** KST 벽시계 문자열 */
  updatedAt: string
  tryCount: number
  lastError: string | null
  queuedAt: string
}

export interface MetaRow {
  key: string
  value: string
}

class DailyDb extends Dexie {
  outbox!: EntityTable<OutboxRow, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('daily')
    // 도메인 테이블은 2단계에서 버전 2로 추가한다.
    this.version(1).stores({
      outbox: '++seq, clientUuid, table',
      meta: 'key',
    })
  }
}

export const db = new DailyDb()
