import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useSession } from '../store/session.ts'

export default function RegisterPage() {
  const register = useSession((s) => s.register)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await register(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">회원가입</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">이메일</span>
          <input
            type="email" value={email} required autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">비밀번호</span>
          <input
            type="password" value={password} required minLength={10}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <span className="text-xs text-gray-500">10자 이상 입력해주세요.</span>
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button
          type="submit" disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          가입하기
        </button>
      </form>

      <p className="text-sm text-gray-600">
        이미 계정이 있으신가요? <Link to="/login" className="underline">로그인</Link>
      </p>
    </main>
  )
}
