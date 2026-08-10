import { useState, type FormEvent } from 'react'
import type { ExpenseKind } from '@daily/shared'
import type { LocalExpenseCategory } from '../../db/index.ts'
import type { ExpenseInput } from './repository.ts'

/** 소수점 두 자리까지의 0 이상 숫자. 서버 검증과 같은 규칙이다. */
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/

interface Props {
  categories: LocalExpenseCategory[]
  onSubmit: (input: ExpenseInput) => Promise<void>
  occurredOn: string
}

export default function ExpenseForm({ categories, onSubmit, occurredOn }: Props) {
  const [kind, setKind] = useState<ExpenseKind>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [categoryClientUuid, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = amount.trim()
    if (!AMOUNT.test(trimmed)) {
      setError('금액은 소수점 두 자리까지의 0 이상 숫자여야 합니다.')
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({
        occurredOn,
        kind,
        // 금액은 문자열 그대로 넘긴다. Number를 거치면 12000.10이 깨진다.
        amount: trimmed,
        categoryClientUuid: categoryClientUuid || null,
        memo: memo.trim() || null,
      })
      setAmount('')
      setMemo('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
      <div className="flex gap-2">
        {(['EXPENSE', 'INCOME'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              kind === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {k === 'EXPENSE' ? '지출' : '수입'}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">금액</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          required
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">카테고리</span>
        <select
          value={categoryClientUuid}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">미분류</option>
          {categories.map((c) => (
            <option key={c.clientUuid} value={c.clientUuid}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">메모</span>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={500}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        기록하기
      </button>
    </form>
  )
}
