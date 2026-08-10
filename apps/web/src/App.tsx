import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import ExpensePage from './features/expense/ExpensePage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import { useSession } from './store/session.ts'
import { useSync } from './store/sync.ts'

export default function App() {
  const status = useSession((s) => s.status)
  const userId = useSession((s) => s.user?.id)
  const init = useSession((s) => s.init)
  const startSync = useSync((s) => s.start)
  const stopSync = useSync((s) => s.stop)

  useEffect(() => { void init() }, [init])

  // 로그인 상태에서만 동기화 트리거를 건다. 로그아웃하면 타이머와 이벤트
  // 리스너를 반드시 걷어낸다 — 남겨두면 401을 반복해서 때린다.
  useEffect(() => {
    if (status !== 'AUTHENTICATED' || userId === undefined) return undefined
    void startSync(userId)
    return () => stopSync()
  }, [status, userId, startSync, stopSync])

  if (status === 'LOADING') {
    return <main className="grid min-h-dvh place-items-center">불러오는 중…</main>
  }

  return (
    <BrowserRouter>
      <Routes>
        {status === 'AUTHENTICATED' ? (
          <>
            <Route path="/" element={<ExpensePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}
