import { codeLabel } from '../codes/label.ts'
import type { LocalCode, LocalWorkout } from '../db/index.ts'

/**
 * 운동 기록을 한 줄로 줄이는 공용 자리.
 *
 * `WorkoutPage`와 캘린더 요약이 같은 모양으로 세트·유산소를 표시해야
 * 한다는 규칙이 화면마다 다시 구현되면 한쪽에서 조용히 깨진다 — `live()`,
 * `money.ts`와 같은 이유로 여기에 둔다.
 *
 * `sets`가 null인 근력 기록과 `durationMin`이 null인 유산소 기록을
 * 방어하는 것은 `sync/apply.ts`가 서버 페이로드를 재검증 없이 Dexie에
 * 쓰기 때문이다. 화면단 검증을 거치지 않은 값이 그대로 렌더 경로에
 * 들어올 수 있어 이 방어는 여기 한 곳에서 항상 필요하다.
 */

/** `60kg×10, ×12` — 맨몸 세트는 무게 없이 횟수만 적는다. */
export function formatSets(sets: LocalWorkout['sets']): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .map((s) => (s.weightKg === null ? `×${s.reps}` : `${s.weightKg}kg×${s.reps}`))
    .join(', ')
}

/** `30분 · 보통` — 강도 라벨은 codes 캐시에서 찾는다. */
export function formatCardio(w: LocalWorkout, intensities: LocalCode[]): string {
  if (w.durationMin == null) return ''
  const parts = [`${w.durationMin}분`]
  const label = codeLabel(intensities, w.intensity)
  if (label) parts.push(label)
  return parts.join(' · ')
}
