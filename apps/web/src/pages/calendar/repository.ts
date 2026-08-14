import { db, live, type LocalBookNote, type LocalExpense, type LocalWorkout } from '../../db/index.ts'

/**
 * 캘린더가 데이터에 닿는 유일한 통로.
 *
 * `pages/<기능>/` 폴더를 임포트하지 않는다. 캘린더가 필요한 질의는 기능
 * 화면의 것과 모양이 다르다 — 기능 화면은 "하루치 한 도메인"을 읽지만
 * 여기서는 "한 달치 세 도메인"을 읽어 날짜별로 접는다. 재사용할 구석이
 * 없어서, 공용 자리로 승격하면 캘린더가 쓰지 않는 함수까지 함께 끌려간다.
 */

export interface DayRecords {
  expenses: LocalExpense[]
  workouts: LocalWorkout[]
  bookNotes: LocalBookNote[]
}

/** key는 'YYYY-MM-DD'. 기록이 하나도 없는 날은 키 자체가 없다 */
export type MonthRecords = Map<string, DayRecords>

/**
 * 한 달치를 한 번에 읽는다.
 *
 * 격자의 점도 선택한 날의 상세도 이 결과 하나에서 나온다. 날짜를 눌러도
 * 추가 조회가 없고, 조회는 월을 넘길 때만 일어난다. 한 달치 세 도메인은
 * 인덱스 범위 스캔으로 수백 행 수준이라 통째로 들고 있어도 부담이 없다.
 *
 * 상한을 그 달의 말일로 계산하지 않고 항상 31로 잡는다. 날짜가 문자열이라
 * 사전순이 곧 시간순이고 `'2026-02-28' < '2026-02-31'`이므로, 상한만
 * 넉넉하면 2월도 30일 달도 전부 잡힌다 — 윤년·월말 계산 자체를 없앤다.
 */
export async function loadMonth(userId: number, month: string): Promise<MonthRecords> {
  const from = `${month}-01`
  const to = `${month}-31`

  const [expenses, workouts, bookNotes] = await Promise.all([
    db.expenses.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
    db.workouts.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
    db.bookNotes.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
  ])

  const records: MonthRecords = new Map()

  // 살아있는 행이 처음 닿는 날짜에만 칸을 만든다. 툼스톤뿐인 날에 빈
  // 칸이 생기면 격자에 점이 없는데도 "기록 있음"으로 잡힌다.
  const bucket = (date: string): DayRecords => {
    const found = records.get(date)
    if (found) return found
    const created: DayRecords = { expenses: [], workouts: [], bookNotes: [] }
    records.set(date, created)
    return created
  }

  for (const row of live(expenses)) bucket(row.occurredOn).expenses.push(row)
  for (const row of live(workouts)) bucket(row.occurredOn).workouts.push(row)
  for (const row of live(bookNotes)) bucket(row.occurredOn).bookNotes.push(row)

  return records
}

/**
 * 지출 항목에 붙일 카테고리 이름을 `clientUuid → name`으로 돌려준다.
 *
 * `pages/expense/`의 `listCategories`와 같은 질의지만 캘린더가 자기 것을
 * 갖는다. 지출 폴더를 임포트하는 순간 이 파일의 전제가 무너진다.
 */
export async function listCategoryNames(userId: number): Promise<Map<string, string>> {
  const rows = await db.expenseCategories.where('userId').equals(userId).toArray()
  return new Map(live(rows).map((c) => [c.clientUuid, c.name]))
}
