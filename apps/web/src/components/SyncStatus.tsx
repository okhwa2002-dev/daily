import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/index.ts'
import { useSync } from '../store/sync.ts'

/**
 * 동기화 상태를 항상 보이게 둔다.
 *
 * 이 표시가 없으면 동기화가 조용히 멈춰도 아무도 알아채지 못한다. 사용자는
 * 며칠치 기록이 다른 기기에 없다는 것을 한참 뒤에 발견한다.
 */
export default function SyncStatus() {
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const failures = useLiveQuery(() => db.syncFailures.count(), [], 0)
  const syncing = useSync((s) => s.syncing)
  const lastError = useSync((s) => s.lastError)

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {failures > 0 && (
        <span
          role="alert"
          className="rounded-full bg-red-100 px-2 py-1 font-medium text-red-700"
        >
          저장하지 못한 기록 {failures}건
        </span>
      )}

      {pending > 0 ? (
        <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
          미동기화 {pending}건
        </span>
      ) : (
        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500">
          {syncing ? '동기화 중…' : '동기화됨'}
        </span>
      )}

      {lastError && (
        <span className="text-gray-500">{lastError}</span>
      )}
    </div>
  )
}
