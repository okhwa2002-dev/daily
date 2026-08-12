import { useState, type FormEvent } from 'react'
import { kstDate } from '@daily/shared'
import type { BookNoteInput } from './repository.ts'

interface Props {
  bookClientUuid: string
  onSubmit: (input: BookNoteInput) => Promise<void>
}

export default function BookNoteForm({ bookClientUuid, onSubmit }: Props) {
  const [occurredOn, setOccurredOn] = useState(() => kstDate(new Date()))
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (trimmed === '') {
      setError('감상평을 입력해 주세요.')
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({ occurredOn, bookClientUuid, content: trimmed })
      setContent('')
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
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">날짜</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">감상평</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={4}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        남기기
      </button>
    </form>
  )
}
