import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { takeBatch } from '../../sync/outbox.ts'
import {
  deleteWorkout, listRecentNames, listWorkoutsByDate, saveWorkout,
  type WorkoutInput,
} from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-13'

const strength = (over: Partial<WorkoutInput> = {}): WorkoutInput => ({
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, ...over,
})

beforeEach(async () => {
  await db.workouts.clear()
  await db.outbox.clear()
})

describe('운동 저장', () => {
  it('로컬에 저장하고 같은 동작으로 큐에 넣는다', async () => {
    const uuid = await saveWorkout(USER, strength({ memo: '가슴날' }))

    const rows = await listWorkoutsByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.memo).toBe('가슴날')
    // 레코드만 쓰이고 큐 적재가 빠지면 그 기록은 이 기기에만 남는다.
    const queue = await takeBatch(10)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.clientUuid).toBe(uuid)
  })

  // db.workouts.put과 enqueue 두 곳을 모두 고쳐야 하는 자리다. 로컬만
  // 확인하면 payload.sets가 undefined로 새어도 통과한다.
  it('세트가 큐 페이로드까지 그대로 간다', async () => {
    await saveWorkout(USER, strength({
      sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }],
    }))

    const [row] = await takeBatch(1)
    expect((row!.payload as { sets: unknown }).sets).toEqual([
      { reps: 10, weightKg: 60 }, { reps: 12, weightKg: null },
    ])
  })

  it('큐 페이로드는 서버가 받는 필드만 담는다', async () => {
    await saveWorkout(USER, strength())
    const [row] = await takeBatch(1)
    expect(Object.keys(row!.payload as object).sort()).toEqual([
      'bodyPart', 'durationMin', 'intensity', 'kind', 'memo',
      'name', 'occurredOn', 'sets',
    ])
  })

  it('같은 clientUuid로 다시 저장하면 수정이다', async () => {
    const uuid = await saveWorkout(USER, strength({ sets: [{ reps: 10, weightKg: 60 }] }))
    await saveWorkout(USER, strength({ sets: [{ reps: 8, weightKg: 70 }] }), uuid)

    const rows = await listWorkoutsByDate(USER, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sets).toEqual([{ reps: 8, weightKg: 70 }])
    expect(await takeBatch(10)).toHaveLength(1)
  })

  it('다른 날짜·다른 사용자의 기록은 섞이지 않는다', async () => {
    await saveWorkout(USER, strength())
    await saveWorkout(USER, strength({ occurredOn: '2026-08-12' }))
    await saveWorkout(OTHER, strength())

    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(1)
  })
})

describe('운동 삭제', () => {
  it('툼스톤을 남기고 조회에서 뺀다', async () => {
    const uuid = await saveWorkout(USER, strength())
    await db.workouts.update(uuid, { serverId: 5 })
    await db.outbox.clear()

    await deleteWorkout(USER, uuid)

    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(0)
    // 물리 삭제하면 삭제가 다른 기기로 전파되지 않아 되살아난다.
    expect((await db.workouts.get(uuid))?.deletedAt).not.toBeNull()
    const [queued] = await takeBatch(1)
    expect(queued?.op).toBe('DELETE')
  })

  // serverId가 없으면 서버는 이 레코드를 모른다. 툼스톤을 보낼 이유가 없고,
  // 보내면 서버에 없는 client_uuid로 DELETE가 올라간다.
  it('서버가 모르는 기록을 지우면 큐에 아무것도 남지 않는다', async () => {
    const uuid = await saveWorkout(USER, strength())
    await deleteWorkout(USER, uuid)

    expect(await takeBatch(10)).toHaveLength(0)
  })

  it('남의 레코드는 건드리지 않는다', async () => {
    const uuid = await saveWorkout(USER, strength())
    await deleteWorkout(OTHER, uuid)
    expect(await listWorkoutsByDate(USER, TODAY)).toHaveLength(1)
  })
})

describe('최근 종목', () => {
  it('최근순으로 중복 없이 돌려준다', async () => {
    await saveWorkout(USER, strength({ occurredOn: '2026-08-11', name: '스쿼트' }))
    await saveWorkout(USER, strength({ occurredOn: '2026-08-12', name: '벤치프레스' }))
    await saveWorkout(USER, strength({ occurredOn: '2026-08-13', name: '스쿼트' }))

    expect(await listRecentNames(USER)).toEqual(['스쿼트', '벤치프레스'])
  })

  it('삭제된 기록의 종목은 빠진다', async () => {
    const uuid = await saveWorkout(USER, strength({ name: '데드리프트' }))
    await deleteWorkout(USER, uuid)

    expect(await listRecentNames(USER)).toEqual([])
  })

  it('다른 사용자의 종목은 섞이지 않는다', async () => {
    await saveWorkout(OTHER, strength({ name: '남의운동' }))
    expect(await listRecentNames(USER)).toEqual([])
  })

  it('limit을 넘지 않는다', async () => {
    for (const name of ['A', 'B', 'C']) {
      await saveWorkout(USER, strength({ name }))
    }
    expect(await listRecentNames(USER, 2)).toHaveLength(2)
  })
})
