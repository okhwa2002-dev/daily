import { useState, type FormEvent } from 'react'
import { kstDate, type BookStatus } from '@daily/shared'
import type { LocalBook, LocalCode } from '../../db/index.ts'
import type { BookInput } from './repository.ts'

/** 화면에 보이는 한글 라벨은 코드값과 분리한다. DB에는 코드값만 들어간다. */
export const STATUS_LABEL: Record<BookStatus, string> = {
  WISHLIST: '읽고 싶음',
  READING: '읽는 중',
  DONE: '완독',
}

const STATUSES: BookStatus[] = ['WISHLIST', 'READING', 'DONE']

interface Props {
  initial?: LocalBook
  genres: LocalCode[]
  onSubmit: (input: BookInput) => Promise<void>
  onCancel?: () => void
}

export default function BookForm({ initial, genres, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [summary, setSummary] = useState(initial?.summary ?? '')
  const [status, setStatus] = useState<BookStatus>(initial?.status ?? 'WISHLIST')
  const [startedOn, setStartedOn] = useState(initial?.startedOn ?? '')
  const [finishedOn, setFinishedOn] = useState(initial?.finishedOn ?? '')
  const [genre, setGenre] = useState(initial?.genre ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /**
   * 상태를 고르면 짝이 되는 날짜를 오늘로 채운다.
   *
   * **이미 값이 있으면 덮지 않는다.** 과거에 읽은 책을 등록하면서 상태를
   * 바꿀 때 사용자가 입력한 날짜를 지우면 안 된다.
   */
  function pickStatus(next: BookStatus) {
    setStatus(next)
    const today = kstDate(new Date())
    if (next === 'READING' && startedOn === '') setStartedOn(today)
    if (next === 'DONE' && finishedOn === '') setFinishedOn(today)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '') {
      setError('제목을 입력해 주세요.')
      return
    }
    // DB의 books_period_ck와 shared의 refine이 같은 규칙을 갖는다. 여기서
    // 먼저 잡아 사용자가 그 자리에서 고칠 수 있게 한다.
    if (startedOn !== '' && finishedOn !== '' && finishedOn < startedOn) {
      setError('완독일은 시작일보다 앞설 수 없습니다.')
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({
        title: trimmed,
        author: author.trim() || null,
        summary: summary.trim() || null,
        status,
        startedOn: startedOn || null,
        finishedOn: finishedOn || null,
        genre: genre || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4"
    >
      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pickStatus(s)}
            aria-pressed={status === s}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              status === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">제목</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">저자</span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={100}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">장르</span>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">미지정</option>
          {genre !== '' && !genres.some((g) => g.code === genre) && (
            // 관리자가 지운 코드다. genres(살아있는 코드만)에는 없지만 이
            // 책에는 이미 붙어 있으므로, codeLabel이 목록·상세에서 하는
            // 폴백(코드값 그대로 표시)과 같은 일을 <select>에서도 해준다.
            // 이 옵션이 없으면 일치하는 <option>이 없어 selectedIndex가
            // -1이 되고, 값은 상태에 남아 있는데도 화면은 빈칸으로 보인다.
            <option value={genre}>{genre}</option>
          )}
          {genres.map((g) => (
            <option key={g.code} value={g.code}>{g.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">책 소개</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={2000}
          rows={3}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">시작일</span>
          <input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">완독일</span>
          <input
            type="date"
            value={finishedOn}
            onChange={(e) => setFinishedOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </form>
  )
}
