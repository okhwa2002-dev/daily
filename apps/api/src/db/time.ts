import { toKstTimestamp } from '@daily/shared'

/** 현재 시각을 DB 저장용 KST 벽시계 문자열로 반환한다. */
export function dbNow(): string {
  return toKstTimestamp(new Date())
}

/**
 * DB에서 읽은 시각 문자열의 밀리초를 항상 3자리로 채운다.
 *
 * PostgreSQL은 timestamp를 텍스트로 낼 때 소수점 이하의 뒤따르는 0을 잘라낸다
 * (`.100` → `.1`, `.000` → 점 자체가 없음). 이 값을 그대로 API로 내보내면
 * 클라이언트가 `'2026-08-10 12:00:00'`과 로컬의 `'2026-08-10 12:00:00.000'`을
 * 문자열로 비교하게 되는데, **짧은 쪽이 사전순으로 더 작아서** 서버에서 받은
 * 값이 항상 더 오래된 것으로 판정된다. 그러면 같은 레코드를 끝없이 재전송한다.
 *
 * 시각을 응답에 담기 전에 반드시 통과시킨다.
 */
export function padMillis(s: string): string {
  const [head, frac] = s.split('.')
  return frac === undefined ? `${head}.000` : `${head}.${frac.padEnd(3, '0')}`
}

/**
 * 현재 시각에서 `ms` 밀리초를 뺀 KST 벽시계 문자열.
 *
 * SQL의 `now()`를 쓰지 않는 이유: `synced_at`은 타임존 없는 KST 벽시계인데
 * `now()`는 세션 타임존을 따른다. 세션이 UTC면 비교가 9시간 어긋나 조건이
 * 통째로 거짓이 되고, **pull이 아무 행도 내려보내지 않는다.** 에러는 나지 않는다.
 * 시각은 이 코드베이스의 다른 모든 곳과 같이 Node에서 만든다.
 */
export function dbNowMinus(ms: number): string {
  return toKstTimestamp(new Date(Date.now() - ms))
}
