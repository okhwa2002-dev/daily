import { kstDate } from '@daily/shared'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 쿼리스트링의 `date`를 화면의 초기 날짜로 바꾼다.
 *
 * 캘린더가 넘기는 값은 항상 정상이지만 URL은 사용자가 고칠 수 있고
 * 북마크는 낡는다. 어긋나면 조용히 오늘로 떨어뜨린다 — 에러 화면을
 * 띄울 만한 사고가 아니다.
 *
 * 형식뿐 아니라 실재하는 날짜인지도 본다. `'2026-02-30'`은 정규식을
 * 통과하지만 `<input type="date">`에 넣으면 빈칸으로 렌더되어 사용자는
 * 날짜를 잃은 것으로 읽는다. UTC로 왕복시켜 걸러낸다.
 */
export function dateParam(raw: string | null): string {
  if (raw !== null && DATE_RE.test(raw) && isRealDate(raw)) return raw
  return kstDate(new Date())
}

function isRealDate(value: string): boolean {
  const [year = 0, mon = 0, day = 0] = value.split('-').map(Number)
  const d = new Date(Date.UTC(year, mon - 1, day))
  return d.getUTCFullYear() === year
    && d.getUTCMonth() === mon - 1
    && d.getUTCDate() === day
}
