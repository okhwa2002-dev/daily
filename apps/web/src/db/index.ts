import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  BookStatus, ExpenseKind, OutboxOp, SyncTable,
  WorkoutKind, WorkoutSet,
} from '@daily/shared'

export interface OutboxRow {
  seq: number
  /** 서버 테이블명 (예: 'expenses') */
  table: SyncTable
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

/**
 * 서버가 영구 거부한 변경.
 *
 * 큐에서 빼되 버리지는 않는다. 조용히 버리면 사용자는 기록이 사라진 것을
 * 한참 뒤에 발견한다. 반대로 무한 재시도하면 큐가 그 항목에서 영영 막힌다.
 */
export interface SyncFailureRow {
  id: number
  table: SyncTable
  clientUuid: string
  op: OutboxOp
  payload: unknown
  reason: string
  failedAt: string
}

/** 도메인 레코드가 공통으로 갖는 로컬 컬럼. */
interface LocalRecord {
  /** 로컬 기본키이자 동기화 식별자. 오프라인에서 만든다 */
  clientUuid: string
  userId: number
  /** 서버가 채번한 id. 아직 서버가 모르는 레코드면 null */
  serverId: number | null
  /** KST 벽시계 문자열. LWW 판정 기준 */
  updatedAt: string
  /** null이 아니면 툼스톤 */
  deletedAt: string | null
}

export interface LocalExpenseCategory extends LocalRecord {
  name: string
}

export interface LocalExpense extends LocalRecord {
  occurredOn: string
  kind: ExpenseKind
  /** 금액은 문자열로 다룬다. 부동소수점 연산을 거치지 않는다 */
  amount: string
  categoryClientUuid: string | null
  memo: string | null
}

export interface LocalBook extends LocalRecord {
  title: string
  author: string | null
  /** 책 내용·줄거리. 사용자 감상은 bookNotes에 쌓인다 */
  summary: string | null
  status: BookStatus
  startedOn: string | null
  finishedOn: string | null
  /** 장르 코드값. 라벨은 codes 캐시에서 찾는다 */
  genre: string | null
}

export interface LocalBookNote extends LocalRecord {
  occurredOn: string
  /** 부모 책. 로컬 레코드 간 참조는 clientUuid로 한다 */
  bookClientUuid: string
  content: string
}

export interface LocalWorkout extends LocalRecord {
  occurredOn: string
  kind: WorkoutKind
  name: string
  /** 부위 코드값. 라벨은 codes 캐시에서 찾는다 */
  bodyPart: string | null
  /** 근력 세트. 자식 테이블이 아니라 값 덩어리다 — 운동과 항상 함께 바뀐다 */
  sets: WorkoutSet[] | null
  /** 유산소 지속 시간(분) */
  durationMin: number | null
  /** 강도 코드값. 라벨은 codes 캐시에서 찾는다 */
  intensity: string | null
  memo: string | null
}

/**
 * 공통코드 캐시.
 *
 * 동기화 대상이 아니다 — `LocalRecord`를 확장하지 않는다. 사용자가 만드는
 * 데이터가 아니라 서버에서 통째로 받아 덮어쓰는 읽기 전용 사본이다.
 */
export interface LocalCode {
  groupCode: string
  code: string
  name: string
  sortOrder: number
}

class DailyDb extends Dexie {
  outbox!: EntityTable<OutboxRow, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>
  expenses!: EntityTable<LocalExpense, 'clientUuid'>
  expenseCategories!: EntityTable<LocalExpenseCategory, 'clientUuid'>
  syncFailures!: EntityTable<SyncFailureRow, 'id'>
  books!: EntityTable<LocalBook, 'clientUuid'>
  bookNotes!: EntityTable<LocalBookNote, 'clientUuid'>
  codes!: Table<LocalCode, [string, string]>
  workouts!: EntityTable<LocalWorkout, 'clientUuid'>

  constructor() {
    super('daily')
    this.version(1).stores({
      outbox: '++seq, clientUuid, table',
      meta: 'key',
    })
    // IndexedDB는 null을 키로 쓰지 못한다. deletedAt이나 categoryClientUuid를
    // 인덱스에 넣으면 값이 null인 레코드가 인덱스에서 통째로 빠져 조회에
    // 잡히지 않는다 — 살아있는 레코드가 사라지는 형태로 드러난다.
    // 그래서 이 둘은 인덱스에 넣지 않고 JS에서 거른다.
    this.version(2).stores({
      expenses: 'clientUuid, userId, [userId+occurredOn]',
      expenseCategories: 'clientUuid, userId',
      syncFailures: '++id, clientUuid',
    })
    // deletedAt을 인덱스에 넣지 않는 것은 version 2와 같은 이유다 —
    // IndexedDB가 null을 키로 쓰지 못해 살아있는 레코드가 통째로 빠진다.
    this.version(3).stores({
      books: 'clientUuid, userId, [userId+status]',
      bookNotes: 'clientUuid, userId, bookClientUuid, [userId+occurredOn]',
    })
    // 복합 기본키다. 그룹이 다르면 같은 코드값이 존재할 수 있다.
    this.version(4).stores({
      codes: '[groupCode+code], groupCode',
    })
    // deletedAt을 인덱스에 넣지 않는 것은 version 2·3과 같은 이유다 —
    // IndexedDB가 null을 키로 쓰지 못해 살아있는 레코드가 통째로 빠진다.
    // name 인덱스도 만들지 않는다. 자동완성에 필요한 것은 "최근 쓴 순서"라
    // name 인덱스로는 답이 안 나오고, [userId+occurredOn] 역순 스캔이면 된다.
    this.version(5).stores({
      workouts: 'clientUuid, userId, [userId+occurredOn]',
    })
  }
}

export const db = new DailyDb()

/** 동기화 커서와 사용자 식별자를 담는 meta 키. */
export const META_KEY = {
  lastPulledSyncedAt: 'lastPulledSyncedAt',
  lastPulledId: 'lastPulledId',
  /** 로컬 데이터의 주인. 다른 계정으로 로그인하면 로컬을 비운다 */
  userId: 'userId',
  /** 초기 동기화가 끝났는지 */
  initialSyncDone: 'initialSyncDone',
} as const
