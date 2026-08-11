import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { kstDate } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import {
  deleteExpense, ensureDefaultCategories, listCategories, listExpensesByDate,
  saveExpense, type ExpenseInput,
} from '../../features/expense/repository.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { logoutSafely } from '../../sync/logout.ts'
import ExpenseForm from './ExpenseForm.tsx'

/** 금액 문자열을 부동소수점을 거치지 않고 최소 단위 정수로 더한다. */
function toMinorUnits(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.')
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2))
}

function formatMinorUnits(total: bigint): string {
  const negative = total < 0n
  const abs = negative ? -total : total
  const won = abs / 100n
  return `${negative ? '-' : ''}${won.toLocaleString('ko-KR')}원`
}

export default function ExpensePage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const syncSoon = useSync((s) => s.syncSoon)
  const stopSync = useSync((s) => s.stop)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const [occurredOn, setOccurredOn] = useState(() => kstDate(new Date()))

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 로컬 변경과 pull 결과를
  // 모두 자동으로 반영하므로, 저장 후 목록을 다시 불러오는 코드가 필요 없다.
  const expenses = useLiveQuery(
    () => listExpensesByDate(userId, occurredOn), [userId, occurredOn], [],
  )
  const categories = useLiveQuery(() => listCategories(userId), [userId], [])

  // 초기 동기화가 끝난 뒤에 만든다. 새 기기의 로컬은 비어 있으므로, pull 전에
  // 만들면 서버에 이미 있는 같은 이름이 다른 UUID로 내려와 목록이 두 벌이 된다.
  // 그 중복은 서버까지 올라가 다른 기기로도 퍼진다.
  useEffect(() => {
    if (userId && initialSyncDone) void ensureDefaultCategories(userId)
  }, [userId, initialSyncDone])

  const categoryName = new Map(categories.map((c) => [c.clientUuid, c.name]))

  const total = expenses.reduce((sum, e) => {
    const value = toMinorUnits(e.amount)
    return e.kind === 'INCOME' ? sum + value : sum - value
  }, 0n)

  async function handleSubmit(input: ExpenseInput) {
    await saveExpense(userId, input)
    // 큐에 넣은 직후 바로 보낸다. 온라인이면 사용자가 기다리지 않는다.
    syncSoon(userId)
  }

  async function handleDelete(clientUuid: string) {
    await deleteExpense(userId, clientUuid)
    syncSoon(userId)
  }

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">지출</h1>
        <button type="button" onClick={() => void handleLogout()} className="text-sm underline">
          로그아웃
        </button>
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
          onChange={(e) => setOccurredOn(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <ExpenseForm
        categories={categories}
        occurredOn={occurredOn}
        onSubmit={handleSubmit}
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-gray-600">{occurredOn}</h2>
          <span className={`text-sm font-semibold ${total < 0n ? 'text-gray-900' : 'text-blue-700'}`}>
            합계 {formatMinorUnits(total)}
          </span>
        </div>

        {expenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">기록이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {expenses.map((e) => (
              <li
                key={e.clientUuid}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className={e.kind === 'INCOME' ? 'text-blue-700' : 'text-gray-900'}>
                      {e.kind === 'INCOME' ? '+' : '-'}
                      {formatMinorUnits(toMinorUnits(e.amount))}
                    </span>
                    <span className="ml-2 text-gray-500">
                      {e.categoryClientUuid
                        ? categoryName.get(e.categoryClientUuid) ?? '미분류'
                        : '미분류'}
                    </span>
                  </p>
                  {e.memo && <p className="truncate text-xs text-gray-500">{e.memo}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(e.clientUuid)}
                  aria-label="삭제"
                  className="shrink-0 text-xs text-gray-400 underline"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
