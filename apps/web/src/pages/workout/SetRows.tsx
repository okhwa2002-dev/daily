import type { WorkoutSet } from '@daily/shared'

/** `workoutSetsSchema`의 `.max(50)`과 같은 값이다. */
export const MAX_SETS = 50

/**
 * 폼이 다루는 세트 한 행.
 *
 * 문자열인 것은 의도한 것이다. 입력 중에는 빈 칸일 수 있고, 숫자로 바꾸는
 * 순간 빈 칸과 0을 구분할 수 없게 된다 — 그 둘은 맨몸 운동과 0kg으로 갈린다.
 */
export interface SetRow {
  weightKg: string
  reps: string
}

export const emptySetRow = (): SetRow => ({ weightKg: '', reps: '' })

/** 숫자가 아닌 것은 애초에 입력되지 않게 한다. 타이핑·붙여넣기가 같이 지나는 길목이다. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * 무게는 소수 한 자리까지 받는다. 2.5kg 원판이 흔해 정수만 받으면
 * 62.5kg·7.5kg를 아예 기록할 수 없다. 횟수는 정수라 digitsOnly를 그대로 쓴다.
 *
 * 입력 도중의 '60.'도 통과시켜야 한다 — 여기서 막으면 소수점을 찍는 순간
 * 지워져 소수를 칠 방법이 없다. 저장 시점에 Number()가 '60.'을 60으로 읽는다.
 */
function weightInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  const decimals = rest.join('').slice(0, 1)
  const head = whole.slice(0, 4)
  // 숫자가 하나도 없으면 빈 칸으로 되돌린다. '.'만 남으면 Number('.')가 NaN이
  // 되고, NaN은 JSON.stringify에서 null이 되어 서버에 '맨몸'으로 저장된다 —
  // 사용자가 친 무게가 오류 없이 사라지는 형태다.
  if (head === '' && decimals === '') return ''
  return rest.length === 0 ? head : `${head}.${decimals}`
}

/**
 * 저장 직전에 폼 행을 페이로드 세트로 바꾼다.
 *
 * - 무게·횟수가 **모두** 빈 행은 버린다. `[+ 세트]`로 복사해 놓고 안 채운
 *   행이 그대로 실려 나가면 `reps`가 `positive()`에서 걸려 저장이 통째로
 *   거부되고, 사용자는 이유를 알 수 없다.
 * - 무게만 빈 행은 맨몸 운동이다. `0`으로 바꾸지 않는다 — `0kg`과 "무게 없음"은
 *   다르고, 스키마가 둘 다 허용하므로 잘못된 값이 저장까지 통과해 버린다.
 * **횟수가 빈 행은 여기서 버리지 않는다.** `reps: 0`으로 내보내고 폼이
 * 걸러낸다 — 사용자가 절반만 채운 행을 말없이 지우면 자기가 뭘 잃었는지
 * 모른 채 저장이 끝난다. 빈 행(둘 다 빔)과 달리 이건 실수가 아니라
 * 미완성이라 알려줘야 한다.
 */
export function toSets(rows: SetRow[]): WorkoutSet[] {
  return rows
    .filter((r) => r.weightKg !== '' || r.reps !== '')
    .map((r) => {
      const weight = Number(r.weightKg)
      return {
        reps: Number(r.reps),
        // 빈 칸은 맨몸이다. Number.isFinite 가드는 이중 방어다 — NaN이 새어
        // 나가면 JSON.stringify가 null로 바꿔 맨몸으로 둔갑시킨다.
        weightKg: r.weightKg === '' || !Number.isFinite(weight) ? null : weight,
      }
    })
}

/** 수정 폼의 초기값. 세트가 없으면 빈 행 하나로 시작한다. */
export function toSetRows(sets: WorkoutSet[] | null): SetRow[] {
  if (!sets || sets.length === 0) return [emptySetRow()]
  return sets.map((s) => ({
    weightKg: s.weightKg === null ? '' : String(s.weightKg),
    reps: String(s.reps),
  }))
}

interface Props {
  rows: SetRow[]
  onChange: (rows: SetRow[]) => void
}

export default function SetRows({ rows, onChange }: Props) {
  function update(index: number, patch: Partial<SetRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /**
   * 마지막 행을 복사해 새 행을 만든다.
   *
   * 근력 운동은 세트 간 무게·횟수가 거의 같아 매번 다시 치는 것이 입력
   * 부담의 대부분이다. 값이 다른 세트는 복사된 값을 고치면 된다.
   */
  function add() {
    const last = rows[rows.length - 1] ?? emptySetRow()
    onChange([...rows, { ...last }])
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        // 세트에는 안정적인 식별자가 없다. 행 삭제가 뒤쪽 행의 값을 앞으로
        // 당기는 형태라 인덱스 key로도 표시가 어긋나지 않는다.
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-sm text-gray-500">{i + 1}</span>
          <input
            aria-label={`${i + 1}세트 무게(kg)`}
            value={row.weightKg}
            onChange={(e) => update(i, { weightKg: weightInput(e.target.value) })}
            inputMode="decimal"
            placeholder="맨몸"
            className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-right"
          />
          <span className="text-sm text-gray-500">kg ×</span>
          <input
            aria-label={`${i + 1}세트 횟수`}
            value={row.reps}
            onChange={(e) => update(i, { reps: digitsOnly(e.target.value) })}
            inputMode="numeric"
            maxLength={4}
            className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-right"
          />
          <span className="text-sm text-gray-500">회</span>
          {/* 마지막 한 행은 지울 수 없다 — workoutSetsSchema가 .min(1)이다 */}
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`${i + 1}세트 삭제`}
              className="ml-auto shrink-0 text-xs text-gray-400 underline"
            >
              삭제
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        disabled={rows.length >= MAX_SETS}
        className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
      >
        세트 추가
      </button>
    </div>
  )
}
