import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useSession } from '../store/session.ts'

export default function RegisterPage() {
  const register = useSession((s) => s.register)
  const [loginId, setLoginId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await register(loginId, email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">회원가입</h1>

      {/*
        설명 문구는 label 밖에 두고 aria-describedby로 잇는다. label 안에 넣으면
        접근성 이름이 "아이디영문·숫자·밑줄 4~20자…"가 되어 스크린리더가
        필드 이름을 그렇게 읽는다.
      */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="loginId" className="text-sm text-gray-600">아이디</label>
          <input
            id="loginId" type="text" value={loginId} required
            autoComplete="username" minLength={4} maxLength={20}
            aria-describedby="loginId-hint"
            // 모바일 키보드의 자동 대문자·자동 수정이 개입하면 사용자가 입력한
            // 적 없는 아이디로 가입된다.
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => setLoginId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <span id="loginId-hint" className="text-xs text-gray-500">
            영문·숫자·밑줄 4~20자. 대소문자는 구분하지 않습니다.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-gray-600">이메일</label>
          <input
            id="email" type="email" value={email} required autoComplete="email"
            aria-describedby="email-hint"
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <span id="email-hint" className="text-xs text-gray-500">
            로그인에는 쓰지 않습니다. 비밀번호를 잊었을 때 계정을 되찾는 데 씁니다.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-gray-600">비밀번호</label>
          <input
            id="password" type="password" value={password} required minLength={10}
            autoComplete="new-password" aria-describedby="password-hint"
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <span id="password-hint" className="text-xs text-gray-500">
            10자 이상 입력해주세요.
          </span>
        </div>

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
