import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import { useSession } from './store/session.ts'

function HomePage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  return (
    <main className="p-6">
      <p className="mb-4">{user?.email}</p>
      <button type="button" onClick={() => void logout()} className="underline">
        로그아웃
      </button>
    </main>
  )
}

export default function App() {
  const status = useSession((s) => s.status)
  const init = useSession((s) => s.init)

  useEffect(() => { void init() }, [init])

  if (status === 'LOADING') {
    return <main className="grid min-h-dvh place-items-center">불러오는 중…</main>
  }

  return (
    <BrowserRouter>
      <Routes>
        {status === 'AUTHENTICATED' ? (
          <>
            <Route path="/" element={<HomePage />} />
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
