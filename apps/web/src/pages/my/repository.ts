import { db, live, type LocalBook, type LocalExpense, type LocalWorkout } from '../../db/index.ts'

/**
 * 마이 화면이 데이터에 닿는 유일한 통로.
 *
 * `pages/<기능>/` 폴더를 임포트하지 않는다. 캘린더의 `loadMonth`와도 질의
 * 모양이 다르다 — 저쪽은 "한 달 범위 × 세 도메인"을 날짜별로 접지만
 * 여기는 "오늘 하루 × 두 도메인 + 상태로 고른 책"이다.
 */

export interface TodayRecords {
  expenses: LocalExpense[]
  workouts: LocalWorkout[]
  /** 상태가 READING인 책. 날짜와 무관하다 */
  readingBooks: LocalBook[]
}

/**
 * `useLiveQuery`의 초기값.
 *
 * 모듈 상수로 두어 렌더마다 새 객체가 생기지 않게 한다. 매번 새로 만들면
 * 참조가 달라져 첫 로딩 동안 불필요한 리렌더가 붙는다.
 */
export const EMPTY_TODAY: TodayRecords = { expenses: [], workouts: [], readingBooks: [] }

/**
 * 카드 세 장을 한 번에 먹인다.
 *
 * 지출·운동은 `[userId+occurredOn]`, 책은 `[userId+status]` 인덱스를 그대로
 * 탄다. 오늘 하루치는 몇 건 수준이라 통째로 들고 있어도 부담이 없다.
 */
export async function loadToday(userId: number, date: string): Promise<TodayRecords> {
  const [expenses, workouts, readingBooks] = await Promise.all([
    db.expenses.where('[userId+occurredOn]').equals([userId, date]).toArray(),
    db.workouts.where('[userId+occurredOn]').equals([userId, date]).toArray(),
    db.books.where('[userId+status]').equals([userId, 'READING']).toArray(),
  ])

  return {
    expenses: live(expenses),
    workouts: live(workouts),
    readingBooks: live(readingBooks),
  }
}
