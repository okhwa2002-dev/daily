import type { BodyPart, Intensity, WorkoutKind, WorkoutSet } from '@daily/shared'
import { db, type LocalWorkout } from '../../db/index.ts'
import { enqueue, localNow } from '../../sync/outbox.ts'

/**
 * 화면이 운동 데이터에 닿는 유일한 통로.
 *
 * 읽기·쓰기 모두 로컬 Dexie를 거친다. 화면 컴포넌트는 API를 직접 호출하지
 * 않는다 — 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너진다.
 */

export interface WorkoutInput {
  occurredOn: string
  kind: WorkoutKind
  name: string
  bodyPart: BodyPart | null
  sets: WorkoutSet[] | null
  durationMin: number | null
  intensity: Intensity | null
  memo: string | null
}

/** 자동완성 후보를 찾을 때 훑는 행의 상한. 없으면 폼을 열 때마다 전체를 읽는다. */
const RECENT_SCAN_ROWS = 200

/** `[userId+occurredOn]` 범위 스캔의 양 끝. 날짜 문자열이라 사전순이 곧 시간순이다. */
const DATE_MIN = '0000-01-01'
const DATE_MAX = '9999-12-31'

function newUuid(): string {
  return crypto.randomUUID()
}

/** 살아있는 레코드만 남긴다. deletedAt은 인덱스에 없으므로 여기서 거른다. */
function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}

/** 서버가 받는 필드만 담는다. 공통 컬럼은 서버가 채운다. */
function toPayload(input: WorkoutInput) {
  return {
    occurredOn: input.occurredOn,
    kind: input.kind,
    name: input.name,
    bodyPart: input.bodyPart,
    sets: input.sets,
    durationMin: input.durationMin,
    intensity: input.intensity,
    memo: input.memo,
  }
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export async function listWorkoutsByDate(
  userId: number,
  occurredOn: string,
): Promise<LocalWorkout[]> {
  const rows = await db.workouts.where('[userId+occurredOn]')
    .equals([userId, occurredOn]).toArray()
  return live(rows)
}

/**
 * 최근에 기록한 종목 이름을 최근순·중복 없이 돌려준다.
 *
 * 종목은 자유 입력이라 매번 '벤치프레스'를 다시 치게 된다. 마스터 테이블
 * 대신 이 목록을 `<datalist>`로 제안한다.
 *
 * `name` 인덱스를 따로 만들지 않는 이유는 필요한 것이 "최근 쓴 순서"이기
 * 때문이다. `[userId+occurredOn]`을 역순으로 훑으면 그 순서가 그냥 나온다.
 */
export async function listRecentNames(userId: number, limit = 20): Promise<string[]> {
  const rows = await db.workouts.where('[userId+occurredOn]')
    .between([userId, DATE_MIN], [userId, DATE_MAX], true, true)
    .reverse()
    .limit(RECENT_SCAN_ROWS)
    .toArray()

  const names: string[] = []
  for (const row of live(rows)) {
    if (names.includes(row.name)) continue
    names.push(row.name)
    if (names.length >= limit) break
  }
  return names
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 운동을 저장하고 같은 트랜잭션에서 큐에 넣는다.
 *
 * 레코드만 쓰이고 큐 적재가 실패하면 그 변경은 이 기기에만 남아 영영 서버로
 * 가지 않는다. 사용자는 다른 기기에서 기록이 비어 있는 것을 나중에 발견한다.
 */
export async function saveWorkout(
  userId: number,
  input: WorkoutInput,
  clientUuid: string = newUuid(),
): Promise<string> {
  const updatedAt = localNow()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = await db.workouts.get(clientUuid)
    await db.workouts.put({
      clientUuid,
      userId,
      serverId: existing?.serverId ?? null,
      ...toPayload(input),
      updatedAt,
      deletedAt: null,
    })
    await enqueue({
      table: 'workouts',
      clientUuid,
      op: 'UPSERT',
      payload: toPayload(input),
      updatedAt,
      everSynced: existing?.serverId != null,
    })
  })

  return clientUuid
}

export async function deleteWorkout(userId: number, clientUuid: string): Promise<void> {
  const updatedAt = localNow()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = await db.workouts.get(clientUuid)
    // 남의 레코드나 없는 레코드는 건드리지 않는다.
    if (!existing || existing.userId !== userId) return

    // 툼스톤을 남긴다. 물리 삭제하면 삭제가 다른 기기로 전파되지 않는다.
    await db.workouts.update(clientUuid, { deletedAt: updatedAt, updatedAt })
    await enqueue({
      table: 'workouts',
      clientUuid,
      op: 'DELETE',
      updatedAt,
      everSynced: existing.serverId != null,
    })
  })
}
