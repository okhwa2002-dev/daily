import { create } from 'zustand'
import { isInitialSyncDone, startSync, syncNow, type SyncOutcome } from '../sync/engine.ts'

interface SyncState {
  syncing: boolean
  /** 마지막 동기화 실패 사유. 성공하면 null로 돌아간다 */
  lastError: string | null
  /** 서버가 영구 거부해 사용자 확인이 필요한 건수 */
  rejected: number
  /**
   * 초기 동기화 완료 여부.
   *
   * 완료 전 화면을 열면 데이터가 부분만 보여 사용자가 기록 유실로 오해한다.
   */
  initialSyncDone: boolean

  /** 트리거를 걸고 해제 함수를 보관한다. 로그인 직후 호출한다 */
  start: (userId: number) => Promise<void>
  stop: () => void
  /** 큐에 넣은 직후처럼 "지금 바로" 보내야 할 때 */
  syncSoon: (userId: number) => void
}

let stopTriggers: (() => void) | null = null

export const useSync = create<SyncState>((set) => {
  const applyOutcome = (outcome: SyncOutcome) => {
    set((s) => ({
      syncing: false,
      lastError: outcome.error,
      rejected: s.rejected + outcome.rejected,
      initialSyncDone: outcome.error === null ? true : s.initialSyncDone,
    }))
  }

  return {
    syncing: false,
    lastError: null,
    rejected: 0,
    initialSyncDone: false,

    start: async (userId) => {
      stopTriggers?.()
      set({ initialSyncDone: await isInitialSyncDone(), syncing: true })
      stopTriggers = startSync(userId, { onOutcome: applyOutcome })
    },

    stop: () => {
      stopTriggers?.()
      stopTriggers = null
      set({ syncing: false, lastError: null, rejected: 0, initialSyncDone: false })
    },

    syncSoon: (userId) => {
      set({ syncing: true })
      void syncNow(userId, true).then(applyOutcome)
    },
  }
})
