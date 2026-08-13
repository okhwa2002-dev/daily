import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { kstDate } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import type { LocalWorkout } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { BODY_PART_LABEL, INTENSITY_LABEL } from './labels.ts'
import WorkoutForm from './WorkoutForm.tsx'
import {
  deleteWorkout, listRecentNames, listWorkoutsByDate, saveWorkout,
  type WorkoutInput,
} from './repository.ts'

/** `60kg×10, ×12` — 맨몸 세트는 무게 없이 횟수만 적는다. */
function formatSets(sets: LocalWorkout['sets']): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .map((s) => (s.weightKg === null ? `×${s.reps}` : `${s.weightKg}kg×${s.reps}`))
    .join(', ')
}

function formatCardio(w: LocalWorkout): string {
  // formatSets와 같은 수준의 방어다. 지금은 스키마·CHECK·폼이 삼중으로 막지만,
  // apply.ts는 서버 payload를 재검증 없이 Dexie에 쓴다.
  if (w.durationMin == null) return ''
  const parts = [`${w.durationMin}분`]
  if (w.intensity) parts.push(INTENSITY_LABEL[w.intensity])
  return parts.join(' · ')
}

export default function WorkoutPage() {
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const [occurredOn, setOccurredOn] = useState(() => kstDate(new Date()))
  const [editing, setEditing] = useState<LocalWorkout | null>(null)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 로컬 변경과 pull 결과를
  // 모두 반영하므로 저장 후 목록을 다시 불러오는 코드가 필요 없다.
  const workouts = useLiveQuery(
    () => listWorkoutsByDate(userId, occurredOn), [userId, occurredOn], [],
  )
  // 자동완성 후보. deps에 workouts나 occurredOn을 넣지 않는다 — listRecentNames는
  // userId만 받고 둘 다 참조하지 않는다. workouts는 매 resolve마다 새 배열
  // 참조라 구독이 불필요하게 자주 재생성되고, occurredOn도 같은 이유로 날짜를
  // 넘길 때마다 옵저버블을 다시 만들어 잠깐 [] 로 떨어지는 깜빡임을 만든다.
  // liveQuery는 db.workouts 변경을 deps와 무관하게 스스로 추적하므로, 새 종목
  // 이름은 저장 즉시 후보에 들어온다.
  const recentNames = useLiveQuery(
    () => listRecentNames(userId), [userId], [],
  )

  /**
   * 날짜를 바꾸면 진행 중인 수정을 취소한다.
   *
   * 폼은 제출 시점의 occurredOn을 쓴다 — 새 기록에는 그게 맞지만(지금 보고 있는
   * 날짜에 넣는다), 수정 중에는 사용자가 건드린 적 없는 그 기록의 날짜가 방금
   * 훑어본 날짜로 조용히 바뀐다. 목록은 새 날짜인데 폼은 옛 기록을 붙들고 있는
   * 상태 자체가 앞뒤가 맞지 않으므로, 그 상태를 만들지 않는다.
   */
  function handleDateChange(next: string) {
    setOccurredOn(next)
    setEditing(null)
  }

  async function handleSubmit(input: WorkoutInput) {
    await saveWorkout(userId, input, editing?.clientUuid)
    setEditing(null)
    // 큐에 넣은 직후 바로 보낸다. 온라인이면 사용자가 기다리지 않는다.
    syncSoon(userId)
  }

  async function handleDelete(clientUuid: string) {
    await deleteWorkout(userId, clientUuid)
    if (editing?.clientUuid === clientUuid) setEditing(null)
    syncSoon(userId)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">운동</h1>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 목록을 그대로 보여주면 부분만 보여 기록 유실로 오해한다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">날짜</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(e) => handleDateChange(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {/* key를 바꿔 수정 대상이 달라질 때 폼 상태를 새로 만든다. 없으면
          다른 기록의 수정 버튼을 눌러도 앞 기록의 값이 남는다 */}
      <WorkoutForm
        key={editing?.clientUuid ?? 'new'}
        occurredOn={occurredOn}
        recentNames={recentNames}
        initial={editing ?? undefined}
        onSubmit={handleSubmit}
        onCancel={editing ? () => setEditing(null) : undefined}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-600">{occurredOn}</h2>

        {workouts.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">기록이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workouts.map((w) => (
              <li
                key={w.clientUuid}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="text-gray-900">{w.name}</span>
                    {w.bodyPart && (
                      <span className="ml-2 text-gray-500">{BODY_PART_LABEL[w.bodyPart]}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {w.kind === 'CARDIO' ? formatCardio(w) : formatSets(w.sets)}
                  </p>
                  {w.memo && <p className="truncate text-xs text-gray-400">{w.memo}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(w)}
                    aria-label={`${w.name} 수정`}
                    className="text-xs text-gray-400 underline"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(w.clientUuid)}
                    aria-label={`${w.name} 삭제`}
                    className="text-xs text-gray-400 underline"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
