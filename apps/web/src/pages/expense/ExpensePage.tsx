import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router'
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
import { dateParam } from '../../lib/dateParam.ts'
import BackHeader from '../../components/BackHeader.tsx'
import SyncStatus from '../../components/SyncStatus.tsx'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import ExpenseForm from './ExpenseForm.tsx'
import {
  deleteExpense, ensureDefaultCategories, listCategories, listExpensesByDate,
  saveExpense, type ExpenseInput,
} from './repository.ts'

export default function ExpensePage() {
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  // 캘린더에서 날짜를 들고 넘어올 수 있다. 최초 1회만 읽고 이후에는 화면
  // 안의 날짜 선택기가 주인이다 — 매 렌더 동기화하면 사용자가 고른 날짜를
  // URL이 도로 덮는다.
  const [params] = useSearchParams()
  const [occurredOn, setOccurredOn] = useState(() => dateParam(params.get('date')))

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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <BackHeader title="지출" />

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
          aria-label="날짜"
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
