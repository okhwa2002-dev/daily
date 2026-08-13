/**
 * 공통코드 그룹 코드.
 *
 * **값 집합은 이 파일이 갖지 않는다.** 그룹 안의 코드 목록은 DB의 `codes`
 * 테이블에 있고, 클라이언트는 `GET /codes`로 받아 캐시한다. 배포 없이 코드를
 * 늘리는 것이 이 구조의 목적이므로, 코드값을 여기 박으면 그 목적이 사라진다.
 *
 * 여기 있는 것은 "어떤 그룹이 존재하는가"뿐이다 — 그건 코드가 참조하는
 * 이름이라 컴파일 시점에 고정되어야 한다.
 */
export const CODE_GROUP = {
  BOOK_GENRE: 'BOOK_GENRE',
  BODY_PART: 'BODY_PART',
  INTENSITY: 'INTENSITY',
} as const
export type CodeGroup = (typeof CODE_GROUP)[keyof typeof CODE_GROUP]

/** `GET /codes` 응답의 코드 한 건. */
export interface CodeItem {
  code: string
  name: string
  sortOrder: number
}

/** `GET /codes` 응답의 그룹 한 건. `codes`는 `sortOrder` 순으로 정렬되어 온다. */
export interface CodeGroupPayload {
  groupCode: string
  name: string
  codes: CodeItem[]
}

export interface CodesResponse {
  groups: CodeGroupPayload[]
}
