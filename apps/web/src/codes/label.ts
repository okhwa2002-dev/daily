import type { LocalCode } from '../db/index.ts'

/**
 * 코드값을 화면 라벨로 바꾼다.
 *
 * **캐시에 없으면 코드값을 그대로 돌려준다.** 관리자가 지운 장르를 쓰던 기록이
 * 빈칸이 되면 사용자는 자기 기록이 손상된 것으로 읽는다. 라벨을 모르더라도
 * 무언가 붙어 있다는 사실은 보여야 한다.
 */
export function codeLabel(list: LocalCode[], value: string | null): string | null {
  if (value === null) return null
  return list.find((c) => c.code === value)?.name ?? value
}
