import { clearLocalData, syncNow } from './engine.ts'
import { pendingCount } from './outbox.ts'

export type LogoutOutcome = 'DONE' | 'CANCELLED'

interface LogoutOptions {
  userId: number
  /** 서버 세션을 끊는다 (`useSession.logout`) */
  logout: () => Promise<void>
  /** 미동기화 기록을 버릴지 사용자에게 묻는다. 취소하면 로그아웃하지 않는다 */
  confirmDiscard: (pending: number) => boolean | Promise<boolean>
}

/**
 * 로그아웃하고 로컬 데이터를 비운다.
 *
 * 공용 기기에서 다음 사용자가 남의 일기와 지출 내역을 볼 수 없어야 하므로
 * 로컬을 비우지만, **미동기화 큐가 남아 있으면 그대로 지우지 않는다.**
 *
 * ```
 * 큐 비어 있음 → 즉시 로그아웃 + 로컬 삭제
 * 큐에 N건 남음
 *  ├ 온라인  → 전송 시도 후 로그아웃
 *  └ 오프라인 → 경고 후 사용자 확인
 * ```
 */
export async function logoutSafely(
  { userId, logout, confirmDiscard }: LogoutOptions,
): Promise<LogoutOutcome> {
  let pending = await pendingCount()

  // 온라인이면 먼저 밀어 넣어 본다. 대부분 여기서 큐가 빈다.
  if (pending > 0 && navigator.onLine) {
    await syncNow(userId, true)
    pending = await pendingCount()
  }

  // 아직 남았다면 이 기록은 로그아웃과 함께 사라진다. 반드시 물어본다.
  if (pending > 0 && !(await confirmDiscard(pending))) return 'CANCELLED'

  await logout()
  await clearLocalData()
  return 'DONE'
}
