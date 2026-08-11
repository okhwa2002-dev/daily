import { useState, type FormEvent } from 'react'
import type { ExpenseKind } from '@daily/shared'
import type { LocalExpenseCategory } from '../../db/index.ts'
import type { ExpenseInput } from './repository.ts'

/**
 * 화면은 정수만 받는다 — 원 단위라 소수점을 쓸 일이 없다.
 *
 * shared의 `amountSchema`(`\d{1,10}(\.\d{1,2})?`)보다 **의도적으로 좁다.** 서버와
 * DB(`NUMERIC(12,2)`)는 소수점을 계속 받으므로 이 둘을 맞추려고 되돌리지 않는다.
 * 자릿수 상한만 shared와 같게 유지한다.
 */
const AMOUNT = /^\d{1,10}$/
const AMOUNT_MAX_DIGITS = 10

/** 숫자가 아닌 것은 애초에 입력되지 않게 한다. 타이핑·붙여넣기가 같이 지나는 길목이다. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

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
      setError('금액은 10자리 이하의 숫자여야 합니다.')
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
          onChange={(e) => setAmount(digitsOnly(e.target.value))}
          inputMode="numeric"
          maxLength={AMOUNT_MAX_DIGITS}
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
