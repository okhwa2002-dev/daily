import { describe, expect, it } from 'vitest'
import type { LocalCode, LocalWorkout } from '../db/index.ts'
import { formatCardio, formatSets } from './workoutFormat.ts'

const intensities: LocalCode[] = [
  { groupCode: 'INTENSITY', code: 'MID', name: '보통', sortOrder: 2 },
]

const cardio = (over: Partial<LocalWorkout> = {}): LocalWorkout => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: '2026-08-14', kind: 'CARDIO', name: '러닝', bodyPart: null,
  sets: null, durationMin: 30, intensity: 'MID',
  memo: null, updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

describe('formatSets', () => {
  it('무게가 있는 세트는 무게×횟수로 줄인다', () => {
    expect(formatSets([{ reps: 10, weightKg: 60 }])).toBe('60kg×10')
  })

  it('맨몸 세트는 무게 없이 횟수만 적는다', () => {
    expect(formatSets([{ reps: 12, weightKg: null }])).toBe('×12')
  })

  it('무게 있는 세트와 맨몸 세트를 섞어 보여준다', () => {
    expect(formatSets([{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }]))
      .toBe('60kg×10, ×12')
  })

  it('빈 배열은 빈 문자열이다', () => {
    expect(formatSets([])).toBe('')
  })

  // apply.ts가 서버 페이로드를 재검증 없이 Dexie에 쓴다. sets가 null인
  // 근력 기록이 내려와도 깨지면 안 된다.
  it('null이면 빈 문자열이다', () => {
    expect(formatSets(null)).toBe('')
  })
})

describe('formatCardio', () => {
  it('시간과 강도 라벨을 함께 보여준다', () => {
    expect(formatCardio(cardio(), intensities)).toBe('30분 · 보통')
  })

  it('강도 라벨이 캐시에 없으면 시간만 보여준다', () => {
    expect(formatCardio(cardio({ intensity: null }), intensities)).toBe('30분')
  })

  // durationMin이 null인 유산소 기록도 apply.ts를 거쳐 들어올 수 있다.
  it('durationMin이 null이면 빈 문자열이다', () => {
    expect(formatCardio(cardio({ durationMin: null }), intensities)).toBe('')
  })
})
