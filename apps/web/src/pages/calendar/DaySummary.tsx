import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { codeLabel } from '../../codes/label.ts'
import type { LocalCode, LocalWorkout } from '../../db/index.ts'
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
import type { DayRecords } from './repository.ts'

/**
 * 선택한 날의 기록을 도메인별로 나열한다.
 *
 * 읽기 전용이다. 수정·삭제는 각 기능 화면이 계속 담당하고, 여기서는 보던
 * 날짜를 들고 그 화면으로 넘어가기만 한다 — 폼을 여기서 다시 끌어쓰면
 * 캘린더가 세 기능의 입력 로직에 묶인다.
 */

interface Props {
  /** 'YYYY-MM-DD' */
  date: string
  /** 그날 기록이 하나도 없으면 undefined다 */
  records: DayRecords | undefined
  /** 지출 카테고리 clientUuid → 이름 */
  categoryNames: Map<string, string>
  bodyParts: LocalCode[]
  intensities: LocalCode[]
}

/**
 * `60kg×10, ×12` — 맨몸 세트는 무게 없이 횟수만 적는다.
 *
 * `WorkoutPage`에도 같은 이름의 함수가 있지만 재사용하지 않는다. 기능
 * 폴더를 임포트하지 않기로 했고, 요약의 축약 방식은 기능 화면과 갈라진다.
 *
 * `sets`가 null인 근력 기록을 방어하는 것은 `apply.ts`가 서버 페이로드를
 * 재검증 없이 Dexie에 쓰기 때문이다. 이 방어는 화면마다 필요하다.
 */
function formatSets(sets: LocalWorkout['sets']): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .map((s) => (s.weightKg === null ? `×${s.reps}` : `${s.weightKg}kg×${s.reps}`))
    .join(', ')
}

function formatCardio(w: LocalWorkout, intensities: LocalCode[]): string {
  if (w.durationMin == null) return ''
  const parts = [`${w.durationMin}분`]
  const label = codeLabel(intensities, w.intensity)
  if (label) parts.push(label)
  return parts.join(' · ')
}

function Section(
  { title, note, to, children }:
  { title: string, note: string, to: string, children: ReactNode },
) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-900">{title}</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-gray-600">{note}</span>
          <Link to={to} aria-label={`${title} 화면으로`} className="text-xs text-gray-400 underline">
            자세히
          </Link>
        </div>
      </div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  )
}

export default function DaySummary({ date, records, categoryNames, bodyParts, intensities }: Props) {
  const expenses = records?.expenses ?? []
  const workouts = records?.workouts ?? []
  const bookNotes = records?.bookNotes ?? []

  if (expenses.length === 0 && workouts.length === 0 && bookNotes.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">이 날은 기록이 없습니다.</p>
  }

  // 수입은 더하고 지출은 뺀다. 부동소수점을 거치지 않으려고 최소 단위
  // 정수로 계산한다.
  const total = expenses.reduce((sum, e) => {
    const value = toMinorUnits(e.amount)
    return e.kind === 'INCOME' ? sum + value : sum - value
  }, 0n)

  return (
    <div className="flex flex-col gap-4">
      {expenses.length > 0 && (
        <Section title="지출" note={formatMinorUnits(total)} to={`/expenses?date=${date}`}>
          {expenses.map((e) => (
            <li key={e.clientUuid} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-gray-600">
                {e.categoryClientUuid !== null && (
                  <span className="text-gray-900">
                    {categoryNames.get(e.categoryClientUuid) ?? ''}
                  </span>
                )}
                {e.memo && <span className="ml-2">{e.memo}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-gray-900">
                {formatMinorUnits(e.kind === 'INCOME' ? toMinorUnits(e.amount) : -toMinorUnits(e.amount))}
              </span>
            </li>
          ))}
        </Section>
      )}

      {workouts.length > 0 && (
        <Section title="운동" note={`${workouts.length}건`} to={`/workouts?date=${date}`}>
          {workouts.map((w) => (
            <li key={w.clientUuid} className="text-sm">
              <span className="text-gray-900">{w.name}</span>
              {w.bodyPart && (
                <span className="ml-2 text-gray-500">{codeLabel(bodyParts, w.bodyPart)}</span>
              )}
              <span className="ml-2 text-xs text-gray-500">
                {w.kind === 'CARDIO' ? formatCardio(w, intensities) : formatSets(w.sets)}
              </span>
            </li>
          ))}
        </Section>
      )}

      {bookNotes.length > 0 && (
        // 독서는 날짜별 화면이 아니라 책 목록이다. date를 넘겨도 쓸 자리가 없다.
        <Section title="독서" note={`감상 ${bookNotes.length}개`} to="/books">
          {bookNotes.map((n) => (
            <li key={n.clientUuid} className="truncate text-sm text-gray-600">
              {n.content}
            </li>
          ))}
        </Section>
      )}
    </div>
  )
}
