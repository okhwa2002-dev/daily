import { useLiveQuery } from 'dexie-react-hooks'
import { kstDate } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import type { LocalExpense } from '../../db/index.ts'
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { logoutSafely } from '../../sync/logout.ts'
import SummaryCard from './SummaryCard.tsx'
import { EMPTY_TODAY, loadToday } from './repository.ts'

/** 카드 한 장이 보여줄 미리보기 줄 수 */
const PREVIEW = 3

/**
 * 마이 — 기능별 기록 입구.
 *
 * 홈(캘린더)이 "언제 뭘 기록했나"를 날짜 축으로 묻는다면 여기는 "오늘 뭘
 * 기록했고 지금 뭘 기록할까"를 기능 축으로 묻는다. 그래서 항상 오늘만
 * 본다 — 날짜 선택기를 두면 캘린더와 같은 화면이 두 개가 된다.
 *
 * 읽기 전용이다. 등록·수정·삭제는 카드를 눌러 들어간 기능 화면이 계속
 * 담당한다.
 */
export default function MyPage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const stopSync = useSync((s) => s.stop)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const today = kstDate(new Date())

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 세 테이블의 변경을 스스로
  // 추적하므로, 기능 화면에서 저장하고 돌아오면 카드가 알아서 갱신된다.
  const records = useLiveQuery(() => loadToday(userId, today), [userId, today], EMPTY_TODAY)

  // 수입은 더하고 지출은 뺀다. 부동소수점을 거치지 않으려고 최소 단위
  // 정수로 계산한다.
  const total = records.expenses.reduce((sum, e) => {
    const value = toMinorUnits(e.amount)
    return e.kind === 'INCOME' ? sum + value : sum - value
  }, 0n)

  async function handleLogout() {
    const outcome = await logoutSafely({
      userId,
      logout,
      confirmDiscard: (pending) => window.confirm(
        `동기화되지 않은 기록 ${pending}건이 있습니다.\n`
        + '지금 로그아웃하면 이 기록은 사라집니다. 계속할까요?',
      ),
    })
    if (outcome === 'DONE') stopSync()
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header>
        <h1 className="text-xl font-semibold">마이</h1>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 빈 카드를 그대로 보여주면 기록이 사라진 것으로 읽는다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <div className="flex flex-col gap-3">
        <SummaryCard
          title="지출"
          summary={formatMinorUnits(total)}
          to={`/expenses?date=${today}`}
          empty="오늘 기록이 없습니다"
          lines={records.expenses.slice(0, PREVIEW).map(expenseLine)}
        />
        <SummaryCard
          title="독서"
          summary={`읽는 중 ${records.readingBooks.length}권`}
          to="/books"
          empty="읽는 중인 책이 없습니다"
          lines={records.readingBooks.slice(0, PREVIEW).map((b) => b.title)}
        />
        <SummaryCard
          title="운동"
          summary={`${records.workouts.length}건`}
          to={`/workouts?date=${today}`}
          empty="오늘 기록이 없습니다"
          lines={records.workouts.slice(0, PREVIEW).map((w) => w.name)}
        />
      </div>

      <section className="mt-auto flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <span className="min-w-0 truncate text-sm text-gray-600">{user?.email}</span>
        <button type="button" onClick={() => void handleLogout()} className="shrink-0 text-sm underline">
          로그아웃
        </button>
      </section>
    </main>
  )
}

/**
 * 미리보기 한 줄. 금액이 이끌고 메모는 있을 때만 붙는다.
 *
 * 메모가 있는 항목만 줄로 뽑으면 지출은 기록했는데 메모를 안 단 사용자에게
 * 카드가 빈 것으로 보인다 — "오늘 기록이 없습니다"라는 거짓말이 된다.
 * 금액은 모든 항목이 반드시 갖는다.
 */
function expenseLine(e: LocalExpense): string {
  const value = toMinorUnits(e.amount)
  const amount = formatMinorUnits(e.kind === 'INCOME' ? value : -value)
  return e.memo ? `${amount} · ${e.memo}` : amount
}
