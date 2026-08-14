import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { refreshCodes } from './codes/refresh.ts'
import TabBar from './components/TabBar.tsx'
import BookDetailPage from './pages/book/BookDetailPage.tsx'
import BookListPage from './pages/book/BookListPage.tsx'
import CalendarPage from './pages/calendar/CalendarPage.tsx'
import ExpensePage from './pages/expense/ExpensePage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import WorkoutPage from './pages/workout/WorkoutPage.tsx'
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
    // 코드 캐시는 동기화와 독립이다. 실패해도 던지지 않으므로 기다리지 않는다.
    void refreshCodes()
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
            <Route path="/" element={<><CalendarPage /><TabBar /></>} />
            <Route path="/expenses" element={<><ExpensePage /><TabBar /></>} />
            <Route path="/books" element={<><BookListPage /><TabBar /></>} />
            {/* 상세는 목록 안쪽 화면이다. 탭바를 두면 돌아올 자리를 잃는다 */}
            <Route path="/books/:clientUuid" element={<BookDetailPage />} />
            <Route path="/workouts" element={<><WorkoutPage /><TabBar /></>} />
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
