import type { BodyPart, Intensity } from '@daily/shared'

/**
 * 코드값 → 화면 라벨.
 *
 * DB에는 표시용 문자열을 넣지 않는다. `BODY_PART`·`INTENSITY`는 값 집합이
 * 코드에 있는 정적 코드라 `codes` 캐시(공통코드 테이블)를 거치지 않는다 —
 * 그쪽은 `BOOK_GENRE`처럼 런타임에 관리자가 바꾸는 값만 쓴다.
 *
 * `Record<BodyPart, string>`이라 코드값이 늘면 여기가 컴파일 에러로 따라온다.
 */
export const BODY_PART_LABEL: Record<BodyPart, string> = {
  CHEST: '가슴', BACK: '등', LEGS: '하체', SHOULDERS: '어깨',
  ARMS: '팔', CORE: '코어', FULL_BODY: '전신',
}

export const INTENSITY_LABEL: Record<Intensity, string> = {
  LOW: '가볍게', MID: '보통', HIGH: '힘들게',
}
