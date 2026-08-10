import { toKstTimestamp } from '@daily/shared'

/** 현재 시각을 DB 저장용 KST 벽시계 문자열로 반환한다. */
export function dbNow(): string {
  return toKstTimestamp(new Date())
}
