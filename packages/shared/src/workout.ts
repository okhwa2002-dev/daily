import { z } from 'zod'

/**
 * 근력 운동의 세트 하나. `workouts.sets` JSONB 컬럼에 배열로 들어간다.
 *
 * 세트를 자식 테이블로 분리하지 않는 이유는 동기화 단위를 1레코드로 유지하기
 * 위해서다. 대신 JSONB는 DB CHECK로 모양을 막을 수 없으므로, 이 스키마가
 * 유일한 방어선이다. 서버 진입 시점에 반드시 통과시킨다.
 */
export const workoutSetSchema = z.object({
  reps: z.number().int().positive().max(1000),
  /** 맨몸 운동은 무게가 없다. */
  weightKg: z.number().nonnegative().max(1000).nullable(),
})
export type WorkoutSet = z.infer<typeof workoutSetSchema>

export const workoutSetsSchema = z.array(workoutSetSchema).min(1).max(50)
