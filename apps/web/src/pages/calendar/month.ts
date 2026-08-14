/**
 * 캘린더 격자의 날짜 계산.
 *
 * DB를 모르는 순수 함수만 둔다. 오프바이원이 나오는 자리라 컴포넌트와
 * 섞지 않고 단위 테스트를 붙인다.
 *
 * **모든 계산을 UTC로 한다.** `new Date(2026, 7, 1)` 같은 로컬 생성자는
 * 실행 환경 타임존에 따라 날짜가 하루 밀린다 — 여기서 다루는 것은 시각이
 * 아니라 달력의 칸이므로 타임존이 개입할 여지를 아예 없앤다.
 */

export interface MonthGridShape {
  /** 격자 첫 줄 앞에 비워둘 칸 수 (0~6). 그 달 1일의 요일과 같다 */
  leadingBlanks: number
  /** 'YYYY-MM-DD' 오름차순. 그 달의 실제 날짜만 담는다 */
  days: string[]
}

function parse(month: string): { year: number, mon: number } {
  const [year = 0, mon = 1] = month.split('-').map(Number)
  return { year, mon }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function monthGrid(month: string): MonthGridShape {
  const { year, mon } = parse(month)
  // mon은 1-based, Date.UTC의 월은 0-based다. day에 0을 주면 전달의 말일이
  // 나오므로 (year, mon, 0)이 곧 이번 달의 일수다.
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const leadingBlanks = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()

  const days: string[] = []
  for (let d = 1; d <= lastDay; d += 1) {
    days.push(`${month}-${pad(d, 2)}`)
  }
  return { leadingBlanks, days }
}

export function addMonths(month: string, delta: number): string {
  const { year, mon } = parse(month)
  // 월을 0-based 통산 개월수로 바꿔 더한다. 12로 나눈 몫과 나머지가 곧
  // 연도와 월이라 연말·연초 분기가 필요 없다.
  const total = year * 12 + (mon - 1) + delta
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1, 2)}`
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function monthLabel(month: string): string {
  const { year, mon } = parse(month)
  return `${year}년 ${mon}월`
}
