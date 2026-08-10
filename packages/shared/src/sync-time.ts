import { fromKstTimestamp, toKstTimestamp } from './datetime.ts'

/**
 * `2026-08-10T12:00:00.123+09:00` 형태를 성분으로 쪼갠다.
 * 날짜와 시각 구분자는 `T` 또는 공백, 밀리초와 오프셋은 선택이다.
 */
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * 기기 시계가 서버보다 앞서는 것을 허용하는 한계.
 *
 * 이 방어가 없으면 시계가 하루 앞선 기기가 만든 레코드는 이후 모든 정상 수정을
 * `updated_at` 비교에서 이긴다. 사용자는 "수정이 저장되지 않는다"만 겪고,
 * 서버에는 아무 에러도 남지 않는다.
 */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

/** 해당 연·월의 마지막 날. 윤년을 포함해 정확하다. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 클라이언트가 보낸 `updatedAt`을 DB 저장용 KST 벽시계 문자열로 정규화한다.
 *
 * 타임존이 명시돼 있으면 그 기준으로 해석하고, 없으면 KST 벽시계로 본다.
 * 정규화를 빠뜨리면 기기 타임존이 다를 때 last-write-wins 판정이 뒤집힌다.
 *
 * **해석 실패는 반드시 던진다.** `Invalid Date`를 그대로 흘려보내면 이후 모든
 * 시각 비교가 `NaN` 비교(항상 false)가 되어, LWW가 "아무것도 덮어쓰지 않음"으로
 * 조용히 퇴화한다. 이 함수가 별도로 존재하는 이유가 그것이다.
 *
 * 날짜 성분은 `Date`에 넘기기 전에 직접 검증한다. `new Date('2026-02-30T00:00:00Z')`는
 * Invalid Date가 아니라 **3월 2일로 굴러가기** 때문에, 파싱 결과만 봐서는
 * 잘못된 날짜를 걸러낼 수 없다.
 *
 * @param input ISO 8601 문자열 또는 KST 벽시계 문자열
 * @param now   서버 현재 시각. 미래 시각 판정 기준 (테스트에서 주입한다)
 * @returns `'YYYY-MM-DD HH:mm:ss.SSS'`
 */
export function normalizeClientTimestamp(input: string, now: Date = new Date()): string {
  const s = typeof input === 'string' ? input.trim() : ''
  if (!s) throw new Error('updatedAt이 비어 있습니다.')

  const m = TIMESTAMP.exec(s)
  if (!m) throw new Error(`updatedAt을 해석할 수 없습니다: ${s}`)

  const [, year, month, day, hour, minute, second, millis, zone] = m as unknown as string[]
  const y = Number(year), mo = Number(month), d = Number(day)
  const h = Number(hour), mi = Number(minute), sec = Number(second)

  if (mo < 1 || mo > 12) throw new Error(`존재하지 않는 월입니다: ${s}`)
  if (d < 1 || d > daysInMonth(y, mo)) throw new Error(`존재하지 않는 날짜입니다: ${s}`)
  if (h > 23 || mi > 59 || sec > 59) throw new Error(`존재하지 않는 시각입니다: ${s}`)

  const ms = (millis ?? '').padEnd(3, '0')
  const wall = `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`

  // 오프셋이 없으면 KST 벽시계로 본다. 있으면 그 기준으로 해석한다.
  const instant = zone === undefined
    ? fromKstTimestamp(wall)
    // `+0900`처럼 콜론 없는 오프셋은 Date가 받지 않으므로 콜론을 넣어준다.
    : new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${
      zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
    }`)

  if (Number.isNaN(instant.getTime())) {
    throw new Error(`updatedAt을 해석할 수 없습니다: ${s}`)
  }
  if (instant.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new Error(`updatedAt이 서버 시각보다 지나치게 앞섭니다: ${s}`)
  }

  return toKstTimestamp(instant)
}
