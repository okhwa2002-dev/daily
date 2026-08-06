const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * Date를 DB 저장용 KST 벽시계 문자열로 변환한다.
 * 반환 형식: 'YYYY-MM-DD HH:mm:ss.SSS'
 */
export function toKstTimestamp(d: Date): string {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS)
  return shifted.toISOString().replace('T', ' ').slice(0, 23)
}

/** DB에서 읽은 KST 벽시계 문자열을 Date로 되돌린다. */
export function fromKstTimestamp(s: string): Date {
  const normalized = s.trim().replace(' ', 'T')
  const withMillis = normalized.includes('.') ? normalized : `${normalized}.000`
  return new Date(`${withMillis}+09:00`)
}

/** KST 기준 날짜만 반환한다. 반환 형식: 'YYYY-MM-DD' */
export function kstDate(d: Date): string {
  return toKstTimestamp(d).slice(0, 10)
}
