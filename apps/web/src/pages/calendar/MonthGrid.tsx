import { monthGrid } from './month.ts'
import type { DayRecords, MonthRecords } from './repository.ts'

/**
 * 한 달을 7열 격자로 그린다.
 *
 * 앞뒤 달의 날짜는 빈칸으로 둔다. 흐리게 채워 넣으면 누를 수 있는 것처럼
 * 보이는데, 누르면 달이 바뀌어야 할지 그 자리에서 요약을 보여줘야 할지가
 * 애매해진다. 빈칸이면 그 질문이 생기지 않는다.
 */

interface Props {
  /** 'YYYY-MM' */
  month: string
  records: MonthRecords
  /** 'YYYY-MM-DD' */
  today: string
  /** 선택된 날짜. 월을 넘긴 직후에는 null이다 */
  selected: string | null
  onSelect: (date: string) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 점의 순서와 색.
 *
 * 일기·식사가 붙으면 여기에 한 줄씩 더한다. 색은 도메인을 구분하기만 하면
 * 되고, 정보 자체는 아래 `describe`가 만드는 라벨이 담는다.
 */
const DOMAINS = [
  { key: 'expenses', label: '지출', dot: 'bg-amber-500' },
  { key: 'workouts', label: '운동', dot: 'bg-emerald-500' },
  { key: 'bookNotes', label: '독서', dot: 'bg-sky-500' },
] as const satisfies ReadonlyArray<{ key: keyof DayRecords, label: string, dot: string }>

/** `'8월 14일, 지출·운동 기록'` — 색만으로는 못 읽는 정보를 문장으로 담는다. */
function describeDay(date: string, day: DayRecords | undefined): string {
  const dayNum = Number(date.slice(8, 10))
  const monthNum = Number(date.slice(5, 7))
  const kinds = DOMAINS.filter((d) => (day?.[d.key].length ?? 0) > 0).map((d) => d.label)
  const what = kinds.length === 0 ? '기록 없음' : `${kinds.join('·')} 기록`
  return `${monthNum}월 ${dayNum}일, ${what}`
}

export default function MonthGrid({ month, records, today, selected, onSelect }: Props) {
  const { leadingBlanks, days } = monthGrid(month)

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-gray-500">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {/* 빈칸은 버튼으로 만들지 않는다. 키보드 사용자가 누를 수 없는
            칸을 여섯 번 지나야 한다 */}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {days.map((date) => {
          const day = records.get(date)
          const isToday = date === today
          const isSelected = date === selected

          return (
            <button
              key={date}
              type="button"
              aria-label={describeDay(date, day)}
              aria-pressed={isSelected}
              data-today={isToday}
              onClick={() => onSelect(date)}
              className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-sm ${
                isSelected ? 'bg-gray-900 text-white' : 'text-gray-900'
              } ${isToday && !isSelected ? 'border border-gray-900' : ''}`}
            >
              <span>{Number(date.slice(8, 10))}</span>
              <span className="flex h-1.5 gap-0.5">
                {DOMAINS.map((d) => (
                  day && day[d.key].length > 0
                    ? <span key={d.key} data-dot={d.key} className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
                    : null
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
