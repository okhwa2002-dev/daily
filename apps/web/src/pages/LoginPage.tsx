import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useSession } from '../store/session.ts'

export default function LoginPage() {
  const login = useSession((s) => s.login)
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(loginId, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">로그인</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">아이디</span>
          <input
            type="text" value={loginId} required autoComplete="username"
            // 모바일 키보드가 첫 글자를 대문자로 바꾸거나 자동 수정하면
            // 사용자가 입력한 적 없는 아이디로 로그인을 시도하게 된다.
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setLoginId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">비밀번호</span>
          <input
            type="password" value={password} required autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit" disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          로그인
        </button>
      </form>

      <p className="text-sm text-gray-600">
        계정이 없으신가요? <Link to="/register" className="underline">회원가입</Link>
      </p>
    </main>
  )
}
