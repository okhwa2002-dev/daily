/**
 * 금액을 다루는 공용 자리.
 *
 * 금액은 문자열 또는 최소 단위 정수로만 다루고 부동소수점 연산을 거치지
 * 않는다. 이 규칙이 화면마다 다시 구현되면 한쪽에서 조용히 깨진다 —
 * 지출 화면과 캘린더 요약이 같은 함수를 쓰게 여기에 둔다.
 */

/**
 * 금액 문자열을 부동소수점을 거치지 않고 최소 단위 정수로 바꾼다.
 *
 * 입력은 항상 0 이상이다 — 부호는 소수부가 아니라 레코드의 kind가 가지므로,
 * 음수 문자열(`'-1.50'`)을 넣으면 정수부에만 부호가 붙어 잘못된 값이 나온다.
 */
export function toMinorUnits(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.')
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2))
}

/** 최소 단위 정수를 `'-32,000원'` 형식으로 표시한다. */
export function formatMinorUnits(total: bigint): string {
  const negative = total < 0n
  const abs = negative ? -total : total
  const won = abs / 100n
  return `${negative ? '-' : ''}${won.toLocaleString('ko-KR')}원`
}
