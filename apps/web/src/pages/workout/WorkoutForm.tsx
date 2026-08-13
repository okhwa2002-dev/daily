import { useState, type FormEvent } from 'react'
import { BODY_PART, INTENSITY, type BodyPart, type Intensity } from '@daily/shared'
import type { LocalWorkout } from '../../db/index.ts'
import { BODY_PART_LABEL, INTENSITY_LABEL } from './labels.ts'
import SetRows, { emptySetRow, toSetRows, toSets, type SetRow } from './SetRows.tsx'
import type { WorkoutInput } from './repository.ts'

/**
 * 화면이 다루는 운동 종류는 둘뿐이다.
 *
 * 스키마와 DB CHECK에는 `ETC`가 있지만 폼에 넣지 않는다. 요구가 확인되면
 * 여기에 한 줄 더하는 것으로 끝난다 — `SCHEMA_VERSION`은 그대로다.
 */
const FORM_KINDS = [
  { value: 'STRENGTH', label: '근력' },
  { value: 'CARDIO', label: '유산소' },
] as const
type FormKind = (typeof FORM_KINDS)[number]['value']

const NAME_MAX = 100
const DURATION_MAX = 1440

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

interface Props {
  occurredOn: string
  recentNames: string[]
  initial?: LocalWorkout
  onSubmit: (input: WorkoutInput) => Promise<void>
  onCancel?: () => void
}

export default function WorkoutForm({
  occurredOn, recentNames, initial, onSubmit, onCancel,
}: Props) {
  const [kind, setKindState] = useState<FormKind>(
    initial?.kind === 'CARDIO' ? 'CARDIO' : 'STRENGTH',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [bodyPart, setBodyPart] = useState<string>(initial?.bodyPart ?? '')
  const [intensity, setIntensity] = useState<string>(initial?.intensity ?? '')
  const [rows, setRows] = useState<SetRow[]>(toSetRows(initial?.sets ?? null))
  const [durationMin, setDuration] = useState(
    initial?.durationMin == null ? '' : String(initial.durationMin),
  )
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /**
   * kind를 바꾸면 반대쪽 필드를 비운다.
   *
   * 근력으로 세트를 채우다 유산소로 바꾸고 저장하면 `sets`와 `durationMin`이
   * 함께 실려 zod에서 거부된다. 그 거부는 서버까지 갔다가 REJECTED로 돌아오고,
   * 사용자에게는 "기록이 안 올라감"으로만 보인다. 폼 상태에서 막는다.
   */
  function setKind(next: FormKind) {
    if (next === kind) return
    setKindState(next)
    setRows([emptySetRow()])
    setDuration('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    if (trimmedName === '') {
      setError('종목을 입력해주세요.')
      return
    }

    const sets = kind === 'STRENGTH' ? toSets(rows) : null
    if (kind === 'STRENGTH' && sets!.length === 0) {
      setError('세트를 한 개 이상 입력해주세요.')
      return
    }
    if (kind === 'STRENGTH' && sets!.some((s) => !Number.isInteger(s.reps) || s.reps < 1)) {
      setError('세트의 횟수를 입력해주세요.')
      return
    }

    const duration = kind === 'CARDIO' ? Number(durationMin) : null
    if (kind === 'CARDIO' && (!duration || duration > DURATION_MAX)) {
      setError(`시간은 1분 이상 ${DURATION_MAX}분 이하여야 합니다.`)
      return
    }

    setError(null)
    setPending(true)
    try {
      await onSubmit({
        occurredOn,
        kind,
        name: trimmedName,
        bodyPart: (bodyPart || null) as BodyPart | null,
        sets,
        durationMin: duration,
        intensity: (intensity || null) as Intensity | null,
        memo: memo.trim() || null,
      })
      // 수정 모드는 화면이 폼을 닫으므로 비우지 않는다.
      if (!initial) {
        setName('')
        setRows([emptySetRow()])
        setDuration('')
        setMemo('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
      <div className="flex gap-2">
        {FORM_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            aria-pressed={kind === k.value}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              kind === k.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">종목</span>
        {/* list는 제안일 뿐이다. 새 종목을 그대로 칠 수 있어야 한다 */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          list="workout-name-suggestions"
          maxLength={NAME_MAX}
          required
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      {/*
        datalist는 <label> 밖에 둔다. id로만 연결되므로 중첩될 필요가 없고,
        <label> 안에 두면 옵션 텍스트가 label의 접근성 텍스트에 섞여
        getByLabelText('종목')이 더 이상 정확히 매치되지 않는다.
      */}
      <datalist id="workout-name-suggestions">
        {/* 텍스트 콘텐츠를 넣는다. value만 있으면 화면에도 빈 항목으로 보이고
            접근성 트리의 이름도 비어 getByRole 이름 매칭이 실패한다 */}
        {recentNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </datalist>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">부위</span>
          <select
            value={bodyPart}
            onChange={(e) => setBodyPart(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {BODY_PART.map((p) => (
              <option key={p} value={p}>{BODY_PART_LABEL[p]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-gray-600">강도</span>
          <select
            value={intensity}
            onChange={(e) => setIntensity(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">선택 안 함</option>
            {INTENSITY.map((i) => (
              <option key={i} value={i}>{INTENSITY_LABEL[i]}</option>
            ))}
          </select>
        </label>
      </div>

      {kind === 'STRENGTH' ? (
        <SetRows rows={rows} onChange={setRows} />
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">시간(분)</span>
          <input
            value={durationMin}
            onChange={(e) => setDuration(digitsOnly(e.target.value))}
            inputMode="numeric"
            maxLength={4}
            required
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
      )}

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

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-gray-700"
          >
            취소
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {initial ? '수정하기' : '기록하기'}
        </button>
      </div>
    </form>
  )
}
