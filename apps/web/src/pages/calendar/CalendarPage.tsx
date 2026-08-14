import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CODE_GROUP, kstDate } from '@daily/shared'
import { listCodes } from '../../codes/repository.ts'
import SyncStatus from '../../components/SyncStatus.tsx'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import DaySummary from './DaySummary.tsx'
import MonthGrid from './MonthGrid.tsx'
import { addMonths, monthLabel, monthOf } from './month.ts'
import { listCategoryNames, loadMonth, type MonthRecords } from './repository.ts'

/**
 * 일자별 기록 현황.
 *
 * 한 달을 격자로 펼치고, 날짜를 누르면 그날의 기록을 아래에 나열한다.
 * 읽기 전용이다 — 쓰기가 없어서 아웃박스도 충돌도 이 화면에는 없다.
 *
 * 월 로딩 한 번이 격자와 요약을 모두 먹인다. 날짜를 눌러도 추가 조회가
 * 일어나지 않고, 조회는 월을 넘길 때만 생긴다.
 */
export default function CalendarPage() {
  const user = useSession((s) => s.user)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const today = kstDate(new Date())
  const [month, setMonth] = useState(() => monthOf(today))
  const [selected, setSelected] = useState<string | null>(today)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 세 테이블의 변경을 deps와
  // 무관하게 스스로 추적하므로, 다른 탭에서 저장하거나 pull이 들어오면
  // 격자가 알아서 다시 그려진다.
  // 초기값에 타입을 명시한다. 빈 `new Map()`을 그냥 주면 추론이 넓어져
  // `records.get(selected)`의 반환 타입이 DaySummary의 props와 어긋난다.
  const records = useLiveQuery(
    () => loadMonth(userId, month), [userId, month], new Map() as MonthRecords,
  )
  const categoryNames = useLiveQuery(
    () => listCategoryNames(userId), [userId], new Map<string, string>(),
  )

  // 부위·강도 라벨은 codes 캐시가 갖는다. 사용자와 무관하게 통째로 받아
  // 덮어쓰는 사본이라 deps에 userId가 필요 없다.
  const bodyParts = useLiveQuery(() => listCodes(CODE_GROUP.BODY_PART), [], [])
  const intensities = useLiveQuery(() => listCodes(CODE_GROUP.INTENSITY), [], [])

  /**
   * 월을 넘기면 선택을 해제한다.
   *
   * 새 달의 1일이나 같은 일자를 대신 고르면 사용자가 고른 적 없는 날을
   * 고른 척하게 된다. 격자와 요약이 서로 다른 달을 가리키는 상태 자체를
   * 만들지 않는다.
   */
  function shiftMonth(delta: number) {
    setMonth((m) => addMonths(m, delta))
    setSelected(null)
  }

  /** 이 버튼을 누르는 의도는 "이번 달 격자를 보자"가 아니라 "오늘 뭘 기록했는지 보자"다. */
  function goToday() {
    setMonth(monthOf(today))
    setSelected(today)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">기록 현황</h1>
        <button
          type="button"
          onClick={goToday}
          className="rounded-lg border border-gray-300 px-3 py-1 text-sm"
        >
          오늘
        </button>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 빈 격자를 그대로 보여주면 기록이 사라진 것으로 읽는다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="이전 달" onClick={() => shiftMonth(-1)}
          className="px-3 py-1 text-gray-500">‹</button>
        <h2 className="text-sm font-medium text-gray-900">{monthLabel(month)}</h2>
        <button type="button" aria-label="다음 달" onClick={() => shiftMonth(1)}
          className="px-3 py-1 text-gray-500">›</button>
      </div>

      <MonthGrid
        month={month}
        records={records}
        today={today}
        selected={selected}
        onSelect={setSelected}
      />

      <section className="flex flex-col gap-2 border-t border-gray-200 pt-4">
        {selected === null ? (
          <p className="py-8 text-center text-sm text-gray-400">날짜를 선택하세요.</p>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-600">{selected}</h2>
            <DaySummary
              date={selected}
              records={records.get(selected)}
              categoryNames={categoryNames}
              bodyParts={bodyParts}
              intensities={intensities}
            />
          </>
        )}
      </section>
    </main>
  )
}
