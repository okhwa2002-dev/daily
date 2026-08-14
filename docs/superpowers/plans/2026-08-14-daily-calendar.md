# 일자별 기록 현황(캘린더) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 달을 캘린더 격자로 펼쳐 어느 날에 무엇을 기록했는지 보여주고, 날짜를 누르면 그날의 지출·운동·독서 기록을 나열하는 읽기 전용 홈 화면을 만든다.

**Architecture:** `pages/calendar/`가 자기 Dexie 조회를 직접 갖는다 — 다른 `pages/<기능>/` 폴더를 임포트하지 않는다. `loadMonth`가 세 테이블을 한 번에 읽어 `Map<'YYYY-MM-DD', DayRecords>`로 접고, 격자의 점과 선택한 날의 상세가 모두 그 Map 하나에서 나온다. 날짜를 눌러도 추가 조회가 없고, 조회는 월을 넘길 때만 일어난다.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Dexie + `dexie-react-hooks`, react-router 8, Vitest + Testing Library + fake-indexeddb.

**Spec:** [docs/superpowers/specs/2026-08-14-daily-calendar-design.md](../specs/2026-08-14-daily-calendar-design.md)

## Global Constraints

- **서버 작업이 없다.** DB 마이그레이션, API 라우트, `SCHEMA_VERSION` 인상 모두 없다. `apps/api/`와 `packages/shared/`는 건드리지 않는다.
- **화면은 Dexie만 읽는다.** API를 직접 호출하지 않는다. (`.claude/roles/project-structure.md`)
- **`pages/calendar/`는 다른 `pages/<기능>/`를 임포트하지 않는다.** 공용 자리(`src/db/`, `src/codes/`, `src/lib/`, `src/components/`)만 임포트한다.
- **금액은 문자열 또는 최소 단위 정수(BigInt)로 다룬다.** 부동소수점 연산을 거치지 않는다. (`.claude/roles/database.md`)
- **툼스톤은 화면에 보이지 않는다.** `deletedAt`은 인덱스에 없으므로 조회 후 JS에서 거른다.
- **코드값의 한글 라벨은 `codes` 캐시에서 `codeLabel`로 찾는다.** 라벨 맵을 프론트에 하드코딩하지 않는다.
- 날짜 문자열 형식은 `'YYYY-MM-DD'`, 월 문자열은 `'YYYY-MM'`이다. 사전순이 곧 시간순이다.
- 테스트 실행: `pnpm --filter web test`. 단일 파일은 `pnpm --filter web test -- src/경로/파일.test.ts`.
- 커밋 메시지는 한국어 현재형 서술이다 (`feat(web): …한다`).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `apps/web/src/db/index.ts` | (수정) `live()` 헬퍼를 export — 지금 세 repository에 복사돼 있다 |
| `apps/web/src/lib/money.ts` | (신규) 금액 문자열 ↔ 최소 단위 BigInt 변환·표시 |
| `apps/web/src/lib/dateParam.ts` | (신규) 쿼리스트링 `date` → 화면 초기 날짜 |
| `apps/web/src/pages/calendar/month.ts` | (신규) 격자 날짜 계산. DB를 모르는 순수 함수 |
| `apps/web/src/pages/calendar/repository.ts` | (신규) 월 범위 조회 + 날짜별 집계 |
| `apps/web/src/pages/calendar/MonthGrid.tsx` | (신규) 7열 격자와 점 |
| `apps/web/src/pages/calendar/DaySummary.tsx` | (신규) 선택한 날의 항목 나열 |
| `apps/web/src/pages/calendar/CalendarPage.tsx` | (신규) 월·선택 상태, 데이터 구독, 조립 |
| `apps/web/src/App.tsx` | (수정) `/` → 캘린더, `/expenses` → 지출 |
| `apps/web/src/components/TabBar.tsx` | (수정) 홈·지출·독서·운동 |
| `apps/web/src/pages/expense/ExpensePage.tsx` | (수정) `?date=` 초기값 |
| `apps/web/src/pages/workout/WorkoutPage.tsx` | (수정) `?date=` 초기값 |
| `apps/web/src/pages/expense/repository.ts` | (수정) 로컬 `live()` 제거, `toMinorUnits` 사용처 없음 — 손대지 않음 |
| `apps/web/src/pages/book/repository.ts` | (수정) 로컬 `live()` 제거 |
| `apps/web/src/pages/workout/repository.ts` | (수정) 로컬 `live()` 제거 |

**설계 문서에 없던 항목 하나** — `src/lib/money.ts`. `DaySummary`가 지출 합계를 보여주려면 `ExpensePage`의 `toMinorUnits`/`formatMinorUnits`가 필요한데, 그 함수는 기능 폴더 안에 있어 임포트할 수 없다. 금액 계산이 두 벌로 갈라지면 "부동소수점을 거치지 않는다"는 규칙이 한쪽에서 조용히 깨질 수 있으므로 `live()`와 같은 이유로 공용 자리에 올린다. (Task 2)

---

## Task 1: `live()`를 `src/db/`로 올린다

같은 세 줄이 지출·독서·운동 repository에 복사돼 있고 캘린더가 네 번째 사용처다. 순수 함수를 옮기는 것뿐이라 동작은 변하지 않는다 — 기존 테스트 전부가 그대로 통과하는 것이 이 작업의 검증이다.

**Files:**
- Modify: `apps/web/src/db/index.ts`
- Modify: `apps/web/src/pages/expense/repository.ts:25-28`
- Modify: `apps/web/src/pages/book/repository.ts:33-36`
- Modify: `apps/web/src/pages/workout/repository.ts:36-39`
- Test: `apps/web/src/db/index.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `live<T extends { deletedAt: string | null }>(rows: T[]): T[]` — `apps/web/src/db/index.ts`에서 export

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/db/index.test.ts` 맨 아래에 추가한다. 파일 상단 import에 `live`를 더한다.

```ts
describe('live', () => {
  it('툼스톤을 걷어낸다', () => {
    const rows = [
      { clientUuid: 'a', deletedAt: null },
      { clientUuid: 'b', deletedAt: '2026-08-14 10:00:00.000' },
      { clientUuid: 'c', deletedAt: null },
    ]
    expect(live(rows).map((r) => r.clientUuid)).toEqual(['a', 'c'])
  })

  it('빈 배열을 그대로 돌려준다', () => {
    expect(live([])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/db/index.test.ts`
Expected: FAIL — `live`가 export되지 않아 import 오류가 난다.

- [ ] **Step 3: `db/index.ts`에 구현한다**

`export const db = new DailyDb()` 아래에 붙인다.

```ts
/**
 * 살아있는 레코드만 남긴다.
 *
 * `deletedAt`은 인덱스에 없다 — IndexedDB가 null을 키로 쓰지 못해 인덱스에
 * 넣으면 살아있는 레코드가 통째로 빠진다. 그래서 걸러내는 일이 항상 JS 쪽에
 * 남고, 도메인마다 같은 세 줄이 필요하다.
 */
export function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/db/index.test.ts`
Expected: PASS

- [ ] **Step 5: 세 repository의 로컬 정의를 지우고 임포트로 바꾼다**

세 파일 각각에서 로컬 `live` 함수 정의(주석 포함 4줄)를 삭제하고, 기존 `db` import에 `live`를 더한다.

`apps/web/src/pages/expense/repository.ts`:
```ts
import { db, live, type LocalExpense, type LocalExpenseCategory } from '../../db/index.ts'
```

`apps/web/src/pages/book/repository.ts`:
```ts
import { db, live, type LocalBook, type LocalBookNote } from '../../db/index.ts'
```

`apps/web/src/pages/workout/repository.ts`:
```ts
import { db, live, type LocalWorkout } from '../../db/index.ts'
```

- [ ] **Step 6: 웹 테스트 전체가 통과하는지 확인한다**

Run: `pnpm --filter web test`
Expected: PASS — 순수 함수 이동이므로 실패하는 테스트가 하나도 없어야 한다. 실패한다면 이동이 아니라 동작을 바꾼 것이다.

- [ ] **Step 7: 타입 검사**

Run: `pnpm --filter web typecheck`
Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/db/index.ts apps/web/src/db/index.test.ts apps/web/src/pages/expense/repository.ts apps/web/src/pages/book/repository.ts apps/web/src/pages/workout/repository.ts
git commit -m "refactor(web): 툼스톤 필터를 db 공용 자리로 올린다"
```

---

## Task 2: 금액 헬퍼를 `src/lib/money.ts`로 올린다

`ExpensePage`가 갖고 있는 `toMinorUnits`/`formatMinorUnits`를 캘린더도 써야 한다. 기능 폴더를 임포트할 수 없고, 금액 계산이 두 벌이 되면 부동소수점 금지 규칙이 한쪽에서만 지켜지는 상태가 생긴다.

**Files:**
- Create: `apps/web/src/lib/money.ts`
- Create: `apps/web/src/lib/money.test.ts`
- Modify: `apps/web/src/pages/expense/ExpensePage.tsx:14-25`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `toMinorUnits(amount: string): bigint`
  - `formatMinorUnits(total: bigint): string` — `'-32,000원'` 형식
  - 둘 다 `apps/web/src/lib/money.ts`에서 export

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/lib/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMinorUnits, toMinorUnits } from './money.ts'

describe('toMinorUnits', () => {
  it('소수점 없는 금액을 최소 단위로 바꾼다', () => {
    expect(toMinorUnits('12000')).toBe(1200000n)
  })

  it('소수점 두 자리를 그대로 담는다', () => {
    expect(toMinorUnits('12.34')).toBe(1234n)
  })

  it('소수점 한 자리는 0을 채운다', () => {
    expect(toMinorUnits('12.3')).toBe(1230n)
  })

  it('세 자리 이상은 잘라낸다', () => {
    expect(toMinorUnits('12.349')).toBe(1234n)
  })

  it('0을 다룬다', () => {
    expect(toMinorUnits('0')).toBe(0n)
  })
})

describe('formatMinorUnits', () => {
  it('원 단위로 천단위 구분해 보여준다', () => {
    expect(formatMinorUnits(3200000n)).toBe('32,000원')
  })

  it('음수는 부호를 앞에 붙인다', () => {
    expect(formatMinorUnits(-3200000n)).toBe('-32,000원')
  })

  it('0은 부호 없이 보여준다', () => {
    expect(formatMinorUnits(0n)).toBe('0원')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/lib/money.test.ts`
Expected: FAIL — `./money.ts`를 찾지 못한다.

- [ ] **Step 3: `src/lib/money.ts`를 만든다**

`ExpensePage.tsx`에 있던 두 함수를 그대로 옮긴다. 동작을 바꾸지 않는다.

```ts
/**
 * 금액을 다루는 공용 자리.
 *
 * 금액은 문자열 또는 최소 단위 정수로만 다루고 부동소수점 연산을 거치지
 * 않는다. 이 규칙이 화면마다 다시 구현되면 한쪽에서 조용히 깨진다 —
 * 지출 화면과 캘린더 요약이 같은 함수를 쓰게 여기에 둔다.
 */

/** 금액 문자열을 부동소수점을 거치지 않고 최소 단위 정수로 바꾼다. */
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/lib/money.test.ts`
Expected: PASS

- [ ] **Step 5: `ExpensePage`가 공용 함수를 쓰게 한다**

`apps/web/src/pages/expense/ExpensePage.tsx`에서 로컬 `toMinorUnits`/`formatMinorUnits` 정의(14~25행)를 삭제하고 import를 더한다.

```ts
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
```

- [ ] **Step 6: 지출 화면 테스트가 그대로 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/expense`
Expected: PASS — 함수 이동이므로 합계 표시가 달라지면 안 된다.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/lib/money.ts apps/web/src/lib/money.test.ts apps/web/src/pages/expense/ExpensePage.tsx
git commit -m "refactor(web): 금액 변환을 lib 공용 자리로 올린다"
```

---

## Task 3: 격자 날짜 계산 (`month.ts`)

오프바이원이 나오는 자리라 컴포넌트와 분리해 단위 테스트를 촘촘히 붙인다. DB를 모르는 순수 함수만 둔다.

**월 계산은 전부 UTC로 한다.** `new Date(2026, 7, 1)`처럼 로컬 생성자를 쓰면 실행 환경 타임존에 따라 날짜가 하루 밀린다 — CI와 개발자 기기가 다르면 테스트가 환경에 따라 갈린다.

**Files:**
- Create: `apps/web/src/pages/calendar/month.ts`
- Create: `apps/web/src/pages/calendar/month.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces (모두 `apps/web/src/pages/calendar/month.ts`):
  - `interface MonthGridShape { leadingBlanks: number; days: string[] }`
  - `monthGrid(month: string): MonthGridShape`
  - `addMonths(month: string, delta: number): string`
  - `monthOf(date: string): string`
  - `monthLabel(month: string): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/calendar/month.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addMonths, monthGrid, monthLabel, monthOf } from './month.ts'

describe('monthGrid', () => {
  // 2026-08-01은 토요일이다. 일요일 시작 격자라 앞에 여섯 칸이 빈다.
  it('1일이 토요일인 달은 앞을 여섯 칸 비운다', () => {
    const grid = monthGrid('2026-08')
    expect(grid.leadingBlanks).toBe(6)
    expect(grid.days).toHaveLength(31)
    expect(grid.days[0]).toBe('2026-08-01')
    expect(grid.days[30]).toBe('2026-08-31')
  })

  // 2026-02-01은 일요일이다. 빈칸이 없는 경계 케이스다.
  it('1일이 일요일인 달은 앞을 비우지 않는다', () => {
    const grid = monthGrid('2026-02')
    expect(grid.leadingBlanks).toBe(0)
    expect(grid.days).toHaveLength(28)
  })

  it('윤년 2월은 29일이다', () => {
    const grid = monthGrid('2024-02')
    expect(grid.leadingBlanks).toBe(4)   // 2024-02-01은 목요일
    expect(grid.days).toHaveLength(29)
    expect(grid.days[28]).toBe('2024-02-29')
  })

  it('30일 달을 30일로 센다', () => {
    const grid = monthGrid('2026-09')
    expect(grid.leadingBlanks).toBe(2)   // 2026-09-01은 화요일
    expect(grid.days).toHaveLength(30)
    expect(grid.days[29]).toBe('2026-09-30')
  })

  it('날짜를 두 자리로 채운다', () => {
    expect(monthGrid('2026-08').days[8]).toBe('2026-08-09')
  })
})

describe('addMonths', () => {
  it('다음 달로 넘어간다', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09')
  })

  it('이전 달로 넘어간다', () => {
    expect(addMonths('2026-08', -1)).toBe('2026-07')
  })

  it('연말을 넘어간다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })

  it('연초에서 뒤로 넘어간다', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})

describe('monthOf', () => {
  it('날짜에서 월을 떼어낸다', () => {
    expect(monthOf('2026-08-14')).toBe('2026-08')
  })
})

describe('monthLabel', () => {
  it('한국어 라벨로 바꾼다', () => {
    expect(monthLabel('2026-08')).toBe('2026년 8월')
  })

  it('앞자리 0을 떼고 보여준다', () => {
    expect(monthLabel('2026-01')).toBe('2026년 1월')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/month.test.ts`
Expected: FAIL — `./month.ts`를 찾지 못한다.

- [ ] **Step 3: `month.ts`를 구현한다**

```ts
/**
 * 캘린더 격자의 날짜 계산.
 *
 * DB를 모르는 순수 함수만 둔다. 오프바이원이 나오는 자리라 컴포넌트와
 * 섞지 않고 단위 테스트를 붙인다.
 *
 * **모든 계산을 UTC로 한다.** `new Date(2026, 7, 1)` 같은 로컬 생성자는
 * 실행 환경 타임존에 따라 날짜가 하루 밀린다 — 여기서 다루는 것은 시각이
 * 아니라 달력의 칸이므로 타임존이 개입할 여지를 아예 없앤다.
 */

export interface MonthGridShape {
  /** 격자 첫 줄 앞에 비워둘 칸 수 (0~6). 그 달 1일의 요일과 같다 */
  leadingBlanks: number
  /** 'YYYY-MM-DD' 오름차순. 그 달의 실제 날짜만 담는다 */
  days: string[]
}

function parse(month: string): { year: number, mon: number } {
  const [year = 0, mon = 1] = month.split('-').map(Number)
  return { year, mon }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function monthGrid(month: string): MonthGridShape {
  const { year, mon } = parse(month)
  // mon은 1-based, Date.UTC의 월은 0-based다. day에 0을 주면 전달의 말일이
  // 나오므로 (year, mon, 0)이 곧 이번 달의 일수다.
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const leadingBlanks = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay()

  const days: string[] = []
  for (let d = 1; d <= lastDay; d += 1) {
    days.push(`${month}-${pad(d, 2)}`)
  }
  return { leadingBlanks, days }
}

export function addMonths(month: string, delta: number): string {
  const { year, mon } = parse(month)
  // 월을 0-based 통산 개월수로 바꿔 더한다. 12로 나눈 몫과 나머지가 곧
  // 연도와 월이라 연말·연초 분기가 필요 없다.
  const total = year * 12 + (mon - 1) + delta
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1, 2)}`
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function monthLabel(month: string): string {
  const { year, mon } = parse(month)
  return `${year}년 ${mon}월`
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/month.test.ts`
Expected: PASS — 15개 테스트 전부

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/calendar/month.ts apps/web/src/pages/calendar/month.test.ts
git commit -m "feat(web): 캘린더 격자 날짜 계산을 추가한다"
```

---

## Task 4: 월 범위 조회 (`calendar/repository.ts`)

세 테이블을 한 번에 읽어 날짜별로 접는다. 격자의 점도 선택한 날의 상세도 이 결과 하나에서 나온다.

**Files:**
- Create: `apps/web/src/pages/calendar/repository.ts`
- Create: `apps/web/src/pages/calendar/repository.test.ts`

**Interfaces:**
- Consumes: `live` (Task 1), `db`·`LocalExpense`·`LocalWorkout`·`LocalBookNote` (`src/db/index.ts`)
- Produces (모두 `apps/web/src/pages/calendar/repository.ts`):
  - `interface DayRecords { expenses: LocalExpense[]; workouts: LocalWorkout[]; bookNotes: LocalBookNote[] }`
  - `type MonthRecords = Map<string, DayRecords>`
  - `loadMonth(userId: number, month: string): Promise<MonthRecords>`
  - `listCategoryNames(userId: number): Promise<Map<string, string>>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/calendar/repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { listCategoryNames, loadMonth } from './repository.ts'

const USER = 1
const OTHER = 2

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.bookNotes.clear()
  await db.expenseCategories.clear()
})

const expense = (over: Record<string, unknown> = {}) => db.expenses.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const workout = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', kind: 'STRENGTH', name: '벤치프레스',
  bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }], durationMin: null,
  intensity: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const note = (over: Record<string, unknown> = {}) => db.bookNotes.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: '2026-08-14', bookClientUuid: 'book-1', content: '3부까지 읽음',
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

describe('loadMonth', () => {
  it('세 도메인을 날짜별로 모은다', async () => {
    await expense()
    await workout()
    await note()

    const records = await loadMonth(USER, '2026-08')

    const day = records.get('2026-08-14')
    expect(day?.expenses).toHaveLength(1)
    expect(day?.workouts).toHaveLength(1)
    expect(day?.bookNotes).toHaveLength(1)
  })

  it('기록이 없는 날은 키 자체가 없다', async () => {
    await expense()

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-13')).toBe(false)
    expect(records.get('2026-08-13')).toBeUndefined()
  })

  it('기록이 하나도 없으면 빈 Map이다', async () => {
    const records = await loadMonth(USER, '2026-08')
    expect(records.size).toBe(0)
  })

  it('툼스톤을 제외한다', async () => {
    await expense({ memo: '살아있음' })
    await expense({ memo: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.get('2026-08-14')?.expenses).toHaveLength(1)
    expect(records.get('2026-08-14')?.expenses[0]?.memo).toBe('살아있음')
  })

  // 세 도메인이 모두 툼스톤뿐이면 그 날짜 키를 만들면 안 된다. 만들면
  // 격자에 점이 없는데도 "기록 있음"으로 잡혀 aria-label이 거짓말을 한다.
  it('툼스톤만 있는 날은 키를 만들지 않는다', async () => {
    await expense({ deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-14')).toBe(false)
  })

  it('다른 사용자의 기록을 섞지 않는다', async () => {
    await expense({ userId: OTHER, memo: '남의 것' })
    await expense({ memo: '내 것' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.get('2026-08-14')?.expenses).toHaveLength(1)
    expect(records.get('2026-08-14')?.expenses[0]?.memo).toBe('내 것')
  })

  it('그 달의 1일과 말일을 포함한다', async () => {
    await expense({ occurredOn: '2026-08-01' })
    await expense({ occurredOn: '2026-08-31' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.has('2026-08-01')).toBe(true)
    expect(records.has('2026-08-31')).toBe(true)
  })

  it('인접한 달을 포함하지 않는다', async () => {
    await expense({ occurredOn: '2026-07-31' })
    await expense({ occurredOn: '2026-09-01' })

    const records = await loadMonth(USER, '2026-08')

    expect(records.size).toBe(0)
  })

  // 상한을 '-31'로 고정하는 방식이 짧은 달에서도 성립하는지 본다.
  it('2월 말일도 잡는다', async () => {
    await expense({ occurredOn: '2026-02-28' })

    const records = await loadMonth(USER, '2026-02')

    expect(records.has('2026-02-28')).toBe(true)
  })
})

describe('listCategoryNames', () => {
  it('clientUuid로 이름을 찾을 수 있게 돌려준다', async () => {
    await db.expenseCategories.put({
      clientUuid: 'cat-1', userId: USER, serverId: null, name: '식비',
      updatedAt: '2026-08-14 12:00:00.000', deletedAt: null,
    } as never)

    const names = await listCategoryNames(USER)

    expect(names.get('cat-1')).toBe('식비')
  })

  it('삭제된 카테고리는 빼고 다른 사용자 것도 뺀다', async () => {
    await db.expenseCategories.bulkPut([
      { clientUuid: 'cat-1', userId: USER, serverId: null, name: '지워짐',
        updatedAt: '2026-08-14 12:00:00.000', deletedAt: '2026-08-14 13:00:00.000' },
      { clientUuid: 'cat-2', userId: OTHER, serverId: null, name: '남의 것',
        updatedAt: '2026-08-14 12:00:00.000', deletedAt: null },
    ] as never)

    const names = await listCategoryNames(USER)

    expect(names.size).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/repository.test.ts`
Expected: FAIL — `./repository.ts`를 찾지 못한다.

- [ ] **Step 3: `repository.ts`를 구현한다**

```ts
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

  const range = <T>(table: { where(i: string): { between(a: unknown[], b: unknown[], ai: boolean, bi: boolean): { toArray(): Promise<T[]> } } }) =>
    table.where('[userId+occurredOn]')
      .between([userId, from], [userId, to], true, true)
      .toArray()

  const [expenses, workouts, bookNotes] = await Promise.all([
    range<LocalExpense>(db.expenses),
    range<LocalWorkout>(db.workouts),
    range<LocalBookNote>(db.bookNotes),
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
```

**주의:** 위 `range` 헬퍼의 제네릭 타입이 Dexie 타입과 맞지 않아 컴파일이 막히면, 헬퍼를 쓰지 말고 세 조회를 그대로 펼쳐 쓴다. 타입 곡예보다 반복 세 줄이 낫다.

```ts
const [expenses, workouts, bookNotes] = await Promise.all([
  db.expenses.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
  db.workouts.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
  db.bookNotes.where('[userId+occurredOn]').between([userId, from], [userId, to], true, true).toArray(),
])
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/repository.test.ts`
Expected: PASS — 11개 테스트 전부

- [ ] **Step 5: 타입 검사**

Run: `pnpm --filter web typecheck`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/calendar/repository.ts apps/web/src/pages/calendar/repository.test.ts
git commit -m "feat(web): 캘린더 월 범위 조회를 추가한다"
```

---

## Task 5: `?date=` 초기값 수신

캘린더의 "지출 ›" 링크가 보고 있던 날짜를 들고 가야 한다. 이게 없으면 링크를 눌렀는데 오늘 기록이 뜬다.

**기존 테스트가 깨진다.** `ExpensePage.test.tsx`와 `WorkoutPage.test.tsx`는 지금 `render(<ExpensePage />)`처럼 라우터 없이 렌더한다. `useSearchParams`는 라우터 컨텍스트를 요구하므로 두 파일의 모든 `render` 호출을 `<MemoryRouter>`로 감싸야 한다. 기계적인 변경이고, `LoginPage.test.tsx`가 이미 같은 모양이다.

**Files:**
- Create: `apps/web/src/lib/dateParam.ts`
- Create: `apps/web/src/lib/dateParam.test.ts`
- Modify: `apps/web/src/pages/expense/ExpensePage.tsx`
- Modify: `apps/web/src/pages/workout/WorkoutPage.tsx`
- Modify: `apps/web/src/pages/expense/ExpensePage.test.tsx` (모든 `render` 호출)
- Modify: `apps/web/src/pages/workout/WorkoutPage.test.tsx` (모든 `render` 호출)

**Interfaces:**
- Consumes: `kstDate` (`@daily/shared`)
- Produces: `dateParam(raw: string | null): string` — `apps/web/src/lib/dateParam.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/lib/dateParam.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { kstDate } from '@daily/shared'
import { dateParam } from './dateParam.ts'

const TODAY = kstDate(new Date())

describe('dateParam', () => {
  it('올바른 날짜를 그대로 쓴다', () => {
    expect(dateParam('2026-08-14')).toBe('2026-08-14')
  })

  it('없으면 오늘이다', () => {
    expect(dateParam(null)).toBe(TODAY)
  })

  it('형식이 어긋나면 오늘이다', () => {
    expect(dateParam('2026/08/14')).toBe(TODAY)
    expect(dateParam('오늘')).toBe(TODAY)
    expect(dateParam('')).toBe(TODAY)
  })

  // 형식만 보면 통과하지만 존재하지 않는 날짜다. <input type="date">에
  // 넣으면 빈칸으로 렌더되어 사용자가 날짜를 잃은 것처럼 보인다.
  it('없는 날짜면 오늘이다', () => {
    expect(dateParam('2026-13-01')).toBe(TODAY)
    expect(dateParam('2026-02-30')).toBe(TODAY)
    expect(dateParam('2026-00-10')).toBe(TODAY)
  })

  it('윤년 2월 29일은 통과시킨다', () => {
    expect(dateParam('2024-02-29')).toBe('2024-02-29')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/lib/dateParam.test.ts`
Expected: FAIL — `./dateParam.ts`를 찾지 못한다.

- [ ] **Step 3: `dateParam.ts`를 구현한다**

```ts
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/lib/dateParam.test.ts`
Expected: PASS

- [ ] **Step 5: 두 페이지가 쿼리스트링을 읽게 한다**

`apps/web/src/pages/expense/ExpensePage.tsx` — import를 더하고 35행의 `useState`를 바꾼다.

```ts
import { useSearchParams } from 'react-router'
import { dateParam } from '../../lib/dateParam.ts'
```

```ts
  // 캘린더에서 날짜를 들고 넘어올 수 있다. 최초 1회만 읽고 이후에는 화면
  // 안의 날짜 선택기가 주인이다 — 매 렌더 동기화하면 사용자가 고른 날짜를
  // URL이 도로 덮는다.
  const [params] = useSearchParams()
  const [occurredOn, setOccurredOn] = useState(() => dateParam(params.get('date')))
```

`apps/web/src/pages/workout/WorkoutPage.tsx` — 같은 import를 더하고 40행을 같은 모양으로 바꾼다. `kstDate` import가 다른 곳에서 쓰이지 않으면 제거한다.

- [ ] **Step 6: 기존 두 테스트 파일을 `MemoryRouter`로 감싼다**

두 파일 각각에 import를 더한다.

```ts
import { MemoryRouter } from 'react-router'
```

그리고 파일 안의 모든 `render(<XxxPage />)`를 다음 형태로 바꾼다. `ExpensePage.test.tsx`의 `render(<StrictMode><ExpensePage /></StrictMode>)`는 `<MemoryRouter>`를 가장 바깥에 둔다.

```tsx
render(<MemoryRouter><ExpensePage /></MemoryRouter>)
render(<MemoryRouter><StrictMode><ExpensePage /></StrictMode></MemoryRouter>)
```

- [ ] **Step 7: `?date=`를 읽는 테스트를 두 파일에 더한다**

`ExpensePage.test.tsx`에 추가한다 (`WorkoutPage.test.tsx`에도 `WorkoutPage`로 바꿔 같은 두 개를 더한다):

```tsx
it('쿼리스트링의 날짜로 시작한다', async () => {
  render(
    <MemoryRouter initialEntries={['/expenses?date=2026-08-14']}>
      <ExpensePage />
    </MemoryRouter>,
  )

  const input = await screen.findByLabelText('날짜')
  expect(input).toHaveValue('2026-08-14')
})

it('쿼리스트링이 망가졌으면 오늘로 시작한다', async () => {
  render(
    <MemoryRouter initialEntries={['/expenses?date=2026-02-30']}>
      <ExpensePage />
    </MemoryRouter>,
  )

  const input = await screen.findByLabelText('날짜')
  expect(input).toHaveValue(kstDate(new Date()))
})
```

**주의:** 두 페이지의 날짜 입력은 `<label>` 안에 `<span>날짜</span>`와 `<input>`이 함께 있는 형태다. `findByLabelText('날짜')`가 잡지 못하면 `container.querySelector('input[type="date"]')`로 바꾸거나, 입력에 `aria-label="날짜"`를 붙인다 — 후자가 낫다(스크린리더에도 도움이 된다).

- [ ] **Step 8: 두 페이지 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/expense src/pages/workout`
Expected: PASS — 기존 테스트 전부와 새 테스트 4개

- [ ] **Step 9: 커밋**

```bash
git add apps/web/src/lib/dateParam.ts apps/web/src/lib/dateParam.test.ts apps/web/src/pages/expense apps/web/src/pages/workout
git commit -m "feat(web): 지출·운동 화면이 쿼리스트링의 날짜로 시작한다"
```

---

## Task 6: 격자 컴포넌트 (`MonthGrid.tsx`)

**Files:**
- Create: `apps/web/src/pages/calendar/MonthGrid.tsx`
- Create: `apps/web/src/pages/calendar/MonthGrid.test.tsx`

**Interfaces:**
- Consumes: `monthGrid`·`MonthGridShape` (Task 3), `MonthRecords` (Task 4)
- Produces: `MonthGrid` (default export), props는 아래 `Props`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/calendar/MonthGrid.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MonthGrid from './MonthGrid.tsx'
import type { DayRecords, MonthRecords } from './repository.ts'

const empty: DayRecords = { expenses: [], workouts: [], bookNotes: [] }

const withRecords = (over: Partial<DayRecords>): DayRecords => ({
  ...empty, ...over,
})

function records(entries: Record<string, Partial<DayRecords>>): MonthRecords {
  return new Map(Object.entries(entries).map(([k, v]) => [k, withRecords(v)]))
}

const base = {
  month: '2026-08',
  today: '2026-08-14',
  selected: null,
  onSelect: () => {},
}

describe('월 격자', () => {
  it('그 달의 날짜를 모두 그린다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 1일/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^8월 31일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^9월/ })).not.toBeInTheDocument()
  })

  // 점은 색으로만 구분되므로 라벨이 정보를 문장으로 담아야 한다. 이게
  // 없으면 색각 이상·스크린리더 사용자에게 이 화면의 목적이 성립하지 않는다.
  it('기록이 있는 도메인을 라벨에 적는다', () => {
    render(<MonthGrid {...base} records={records({
      '2026-08-14': { expenses: [{} as never], workouts: [{} as never] },
    })} />)

    expect(screen.getByRole('button', { name: '8월 14일, 지출·운동 기록' }))
      .toBeInTheDocument()
  })

  it('기록이 없는 날은 없다고 적는다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: '8월 14일, 기록 없음' }))
      .toBeInTheDocument()
  })

  it('독서만 있는 날도 라벨에 담는다', () => {
    render(<MonthGrid {...base} records={records({
      '2026-08-03': { bookNotes: [{} as never] },
    })} />)

    expect(screen.getByRole('button', { name: '8월 3일, 독서 기록' }))
      .toBeInTheDocument()
  })

  it('기록이 있는 도메인 수만큼 점을 찍는다', () => {
    const { container } = render(<MonthGrid {...base} records={records({
      '2026-08-14': { expenses: [{} as never], bookNotes: [{} as never] },
    })} />)

    const cell = screen.getByRole('button', { name: /^8월 14일/ })
    expect(cell.querySelectorAll('[data-dot]')).toHaveLength(2)
    // 기록이 없는 날에는 점이 하나도 없다.
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(2)
  })

  it('오늘을 표시한다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 14일/ }))
      .toHaveAttribute('data-today', 'true')
  })

  it('선택한 날을 표시한다', () => {
    render(<MonthGrid {...base} selected="2026-08-03" records={new Map()} />)

    expect(screen.getByRole('button', { name: /^8월 3일/ }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^8월 14일/ }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('날짜를 누르면 그 날짜를 넘긴다', async () => {
    const onSelect = vi.fn()
    render(<MonthGrid {...base} onSelect={onSelect} records={new Map()} />)

    await userEvent.click(screen.getByRole('button', { name: /^8월 3일/ }))

    expect(onSelect).toHaveBeenCalledWith('2026-08-03')
  })

  // 2026-08-01은 토요일이라 앞에 여섯 칸이 빈다. 빈칸이 버튼이면
  // 키보드 사용자가 누를 수 없는 칸을 여섯 번 지나야 한다.
  it('앞 빈칸은 버튼이 아니다', () => {
    render(<MonthGrid {...base} records={new Map()} />)

    expect(screen.getAllByRole('button')).toHaveLength(31)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/MonthGrid.test.tsx`
Expected: FAIL — `./MonthGrid.tsx`를 찾지 못한다.

- [ ] **Step 3: `MonthGrid.tsx`를 구현한다**

```tsx
import { monthGrid } from './month.ts'
import type { DayRecords, MonthRecords } from './repository.ts'

/**
 * 한 달을 7열 격자로 그린다.
 *
 * 앞뒤 달의 날짜는 빈칸으로 둔다. 흐리게 채워 넣으면 누를 수 있는 것처럼
 * 보이는데, 누르면 달이 바뀌어야 할지 그 자리에서 요약을 보여줘야 할지가
 * 애매해진다. 빈칸이면 그 질문이 생기지 않는다.
 */

interface Props {
  /** 'YYYY-MM' */
  month: string
  records: MonthRecords
  /** 'YYYY-MM-DD' */
  today: string
  /** 선택된 날짜. 월을 넘긴 직후에는 null이다 */
  selected: string | null
  onSelect: (date: string) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 점의 순서와 색.
 *
 * 일기·식사가 붙으면 여기에 한 줄씩 더한다. 색은 도메인을 구분하기만 하면
 * 되고, 정보 자체는 아래 `describe`가 만드는 라벨이 담는다.
 */
const DOMAINS = [
  { key: 'expenses', label: '지출', dot: 'bg-amber-500' },
  { key: 'workouts', label: '운동', dot: 'bg-emerald-500' },
  { key: 'bookNotes', label: '독서', dot: 'bg-sky-500' },
] as const satisfies ReadonlyArray<{ key: keyof DayRecords, label: string, dot: string }>

/** `'8월 14일, 지출·운동 기록'` — 색만으로는 못 읽는 정보를 문장으로 담는다. */
function describeDay(date: string, day: DayRecords | undefined): string {
  const dayNum = Number(date.slice(8, 10))
  const monthNum = Number(date.slice(5, 7))
  const kinds = DOMAINS.filter((d) => (day?.[d.key].length ?? 0) > 0).map((d) => d.label)
  const what = kinds.length === 0 ? '기록 없음' : `${kinds.join('·')} 기록`
  return `${monthNum}월 ${dayNum}일, ${what}`
}

export default function MonthGrid({ month, records, today, selected, onSelect }: Props) {
  const { leadingBlanks, days } = monthGrid(month)

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-gray-500">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {/* 빈칸은 버튼으로 만들지 않는다. 키보드 사용자가 누를 수 없는
            칸을 여섯 번 지나야 한다 */}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {days.map((date) => {
          const day = records.get(date)
          const isToday = date === today
          const isSelected = date === selected

          return (
            <button
              key={date}
              type="button"
              aria-label={describeDay(date, day)}
              aria-pressed={isSelected}
              data-today={isToday}
              onClick={() => onSelect(date)}
              className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-sm ${
                isSelected ? 'bg-gray-900 text-white' : 'text-gray-900'
              } ${isToday && !isSelected ? 'border border-gray-900' : ''}`}
            >
              <span>{Number(date.slice(8, 10))}</span>
              <span className="flex h-1.5 gap-0.5">
                {DOMAINS.map((d) => (
                  day && day[d.key].length > 0
                    ? <span key={d.key} data-dot={d.key} className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
                    : null
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/MonthGrid.test.tsx`
Expected: PASS — 9개 테스트 전부

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/calendar/MonthGrid.tsx apps/web/src/pages/calendar/MonthGrid.test.tsx
git commit -m "feat(web): 캘린더 월 격자를 그린다"
```

---

## Task 7: 하루 요약 컴포넌트 (`DaySummary.tsx`)

**Files:**
- Create: `apps/web/src/pages/calendar/DaySummary.tsx`
- Create: `apps/web/src/pages/calendar/DaySummary.test.tsx`

**Interfaces:**
- Consumes: `DayRecords` (Task 4), `formatMinorUnits`·`toMinorUnits` (Task 2), `codeLabel` (`src/codes/label.ts`), `LocalCode` (`src/db/index.ts`)
- Produces: `DaySummary` (default export)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/calendar/DaySummary.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { LocalBookNote, LocalExpense, LocalWorkout } from '../../db/index.ts'
import DaySummary from './DaySummary.tsx'
import type { DayRecords } from './repository.ts'

const DATE = '2026-08-14'

const expense = (over: Partial<LocalExpense> = {}): LocalExpense => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const workout = (over: Partial<LocalWorkout> = {}): LocalWorkout => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const note = (over: Partial<LocalBookNote> = {}): LocalBookNote => ({
  clientUuid: crypto.randomUUID(), userId: 1, serverId: null,
  occurredOn: DATE, bookClientUuid: 'book-1', content: '3부까지 읽음',
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
})

const day = (over: Partial<DayRecords> = {}): DayRecords => ({
  expenses: [], workouts: [], bookNotes: [], ...over,
})

const base = {
  date: DATE,
  categoryNames: new Map([['cat-1', '식비']]),
  bodyParts: [{ groupCode: 'BODY_PART', code: 'CHEST', name: '가슴', sortOrder: 1 }],
  intensities: [{ groupCode: 'INTENSITY', code: 'MID', name: '보통', sortOrder: 2 }],
}

const draw = (records: DayRecords | undefined) => render(
  <MemoryRouter><DaySummary {...base} records={records} /></MemoryRouter>,
)

describe('하루 요약', () => {
  it('기록이 없으면 없다고 알린다', () => {
    draw(undefined)
    expect(screen.getByText('이 날은 기록이 없습니다.')).toBeInTheDocument()
  })

  it('모든 도메인이 비어도 없다고 알린다', () => {
    draw(day())
    expect(screen.getByText('이 날은 기록이 없습니다.')).toBeInTheDocument()
  })

  it('지출 합계를 수입과 상계해 보여준다', () => {
    draw(day({ expenses: [
      expense({ amount: '12000' }),
      expense({ amount: '20000' }),
      expense({ amount: '5000', kind: 'INCOME' }),
    ] }))

    expect(screen.getByText('-27,000원')).toBeInTheDocument()
  })

  it('카테고리 이름을 붙인다', () => {
    draw(day({ expenses: [expense({ categoryClientUuid: 'cat-1', memo: '김밥' })] }))

    expect(screen.getByText('식비')).toBeInTheDocument()
    expect(screen.getByText('김밥')).toBeInTheDocument()
  })

  it('근력은 세트를 줄여 보여준다', () => {
    draw(day({ workouts: [workout({
      sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }],
    }) ] }))

    expect(screen.getByText('60kg×10, ×12')).toBeInTheDocument()
  })

  it('부위 라벨을 코드 캐시에서 찾는다', () => {
    draw(day({ workouts: [workout({ bodyPart: 'CHEST' })] }))
    expect(screen.getByText('가슴')).toBeInTheDocument()
  })

  it('유산소는 시간과 강도를 보여준다', () => {
    draw(day({ workouts: [workout({
      kind: 'CARDIO', name: '러닝', sets: null, durationMin: 30, intensity: 'MID',
    })] }))

    expect(screen.getByText('30분 · 보통')).toBeInTheDocument()
  })

  // apply.ts가 서버 페이로드를 재검증 없이 Dexie에 쓴다. 세트가 없는
  // 근력 기록이 내려와도 화면이 깨지면 안 된다.
  it('세트가 없는 근력 기록에도 깨지지 않는다', () => {
    draw(day({ workouts: [workout({ sets: null })] }))
    expect(screen.getByText('벤치프레스')).toBeInTheDocument()
  })

  it('감상평 내용을 보여준다', () => {
    draw(day({ bookNotes: [note({ content: '3부까지 읽음' })] }))
    expect(screen.getByText('3부까지 읽음')).toBeInTheDocument()
  })

  it('비어 있는 도메인의 섹션은 그리지 않는다', () => {
    draw(day({ expenses: [expense()] }))

    expect(screen.getByRole('heading', { name: '지출' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '운동' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '독서' })).not.toBeInTheDocument()
  })

  it('지출·운동 링크는 보던 날짜를 들고 간다', () => {
    draw(day({ expenses: [expense()], workouts: [workout()] }))

    expect(screen.getByRole('link', { name: '지출 화면으로' }))
      .toHaveAttribute('href', '/expenses?date=2026-08-14')
    expect(screen.getByRole('link', { name: '운동 화면으로' }))
      .toHaveAttribute('href', '/workouts?date=2026-08-14')
  })

  // 독서는 날짜별 화면이 아니라 책 목록이다. date를 받아도 쓸 자리가 없다.
  it('독서 링크는 날짜를 넘기지 않는다', () => {
    draw(day({ bookNotes: [note()] }))

    expect(screen.getByRole('link', { name: '독서 화면으로' }))
      .toHaveAttribute('href', '/books')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/DaySummary.test.tsx`
Expected: FAIL — `./DaySummary.tsx`를 찾지 못한다.

- [ ] **Step 3: `DaySummary.tsx`를 구현한다**

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { codeLabel } from '../../codes/label.ts'
import type { LocalCode, LocalWorkout } from '../../db/index.ts'
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
import type { DayRecords } from './repository.ts'

/**
 * 선택한 날의 기록을 도메인별로 나열한다.
 *
 * 읽기 전용이다. 수정·삭제는 각 기능 화면이 계속 담당하고, 여기서는 보던
 * 날짜를 들고 그 화면으로 넘어가기만 한다 — 폼을 여기서 다시 끌어쓰면
 * 캘린더가 세 기능의 입력 로직에 묶인다.
 */

interface Props {
  /** 'YYYY-MM-DD' */
  date: string
  /** 그날 기록이 하나도 없으면 undefined다 */
  records: DayRecords | undefined
  /** 지출 카테고리 clientUuid → 이름 */
  categoryNames: Map<string, string>
  bodyParts: LocalCode[]
  intensities: LocalCode[]
}

/**
 * `60kg×10, ×12` — 맨몸 세트는 무게 없이 횟수만 적는다.
 *
 * `WorkoutPage`에도 같은 이름의 함수가 있지만 재사용하지 않는다. 기능
 * 폴더를 임포트하지 않기로 했고, 요약의 축약 방식은 기능 화면과 갈라진다.
 *
 * `sets`가 null인 근력 기록을 방어하는 것은 `apply.ts`가 서버 페이로드를
 * 재검증 없이 Dexie에 쓰기 때문이다. 이 방어는 화면마다 필요하다.
 */
function formatSets(sets: LocalWorkout['sets']): string {
  if (!sets || sets.length === 0) return ''
  return sets
    .map((s) => (s.weightKg === null ? `×${s.reps}` : `${s.weightKg}kg×${s.reps}`))
    .join(', ')
}

function formatCardio(w: LocalWorkout, intensities: LocalCode[]): string {
  if (w.durationMin == null) return ''
  const parts = [`${w.durationMin}분`]
  const label = codeLabel(intensities, w.intensity)
  if (label) parts.push(label)
  return parts.join(' · ')
}

function Section(
  { title, note, to, children }:
  { title: string, note: string, to: string, children: ReactNode },
) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-900">{title}</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-gray-600">{note}</span>
          <Link to={to} aria-label={`${title} 화면으로`} className="text-xs text-gray-400 underline">
            자세히
          </Link>
        </div>
      </div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  )
}

export default function DaySummary({ date, records, categoryNames, bodyParts, intensities }: Props) {
  const expenses = records?.expenses ?? []
  const workouts = records?.workouts ?? []
  const bookNotes = records?.bookNotes ?? []

  if (expenses.length === 0 && workouts.length === 0 && bookNotes.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">이 날은 기록이 없습니다.</p>
  }

  // 수입은 더하고 지출은 뺀다. 부동소수점을 거치지 않으려고 최소 단위
  // 정수로 계산한다.
  const total = expenses.reduce((sum, e) => {
    const value = toMinorUnits(e.amount)
    return e.kind === 'INCOME' ? sum + value : sum - value
  }, 0n)

  return (
    <div className="flex flex-col gap-4">
      {expenses.length > 0 && (
        <Section title="지출" note={formatMinorUnits(total)} to={`/expenses?date=${date}`}>
          {expenses.map((e) => (
            <li key={e.clientUuid} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-gray-600">
                {e.categoryClientUuid !== null && (
                  <span className="text-gray-900">
                    {categoryNames.get(e.categoryClientUuid) ?? ''}
                  </span>
                )}
                {e.memo && <span className="ml-2">{e.memo}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-gray-900">
                {formatMinorUnits(e.kind === 'INCOME' ? toMinorUnits(e.amount) : -toMinorUnits(e.amount))}
              </span>
            </li>
          ))}
        </Section>
      )}

      {workouts.length > 0 && (
        <Section title="운동" note={`${workouts.length}건`} to={`/workouts?date=${date}`}>
          {workouts.map((w) => (
            <li key={w.clientUuid} className="text-sm">
              <span className="text-gray-900">{w.name}</span>
              {w.bodyPart && (
                <span className="ml-2 text-gray-500">{codeLabel(bodyParts, w.bodyPart)}</span>
              )}
              <span className="ml-2 text-xs text-gray-500">
                {w.kind === 'CARDIO' ? formatCardio(w, intensities) : formatSets(w.sets)}
              </span>
            </li>
          ))}
        </Section>
      )}

      {bookNotes.length > 0 && (
        // 독서는 날짜별 화면이 아니라 책 목록이다. date를 넘겨도 쓸 자리가 없다.
        <Section title="독서" note={`감상 ${bookNotes.length}개`} to="/books">
          {bookNotes.map((n) => (
            <li key={n.clientUuid} className="truncate text-sm text-gray-600">
              {n.content}
            </li>
          ))}
        </Section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/DaySummary.test.tsx`
Expected: PASS — 12개 테스트 전부

**흔한 실패 하나:** "지출 합계를 수입과 상계해 보여준다" 테스트에서 `-27,000원`이 합계 자리와 항목 자리 양쪽에 나타나 `getByText`가 복수 매치로 실패할 수 있다. 그때는 테스트를 고치지 말고 금액 조합을 겹치지 않게 바꾼다(예: 항목 금액을 12000/20000/5000으로 두면 합계 -27,000원은 어느 항목과도 겹치지 않는다 — 위 테스트가 이미 그렇게 되어 있다).

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/pages/calendar/DaySummary.tsx apps/web/src/pages/calendar/DaySummary.test.tsx
git commit -m "feat(web): 캘린더 하루 요약을 그린다"
```

---

## Task 8: 화면 조립 (`CalendarPage.tsx`)

**Files:**
- Create: `apps/web/src/pages/calendar/CalendarPage.tsx`
- Create: `apps/web/src/pages/calendar/CalendarPage.test.tsx`

**Interfaces:**
- Consumes: `MonthGrid` (Task 6), `DaySummary` (Task 7), `loadMonth`·`listCategoryNames` (Task 4), `addMonths`·`monthLabel`·`monthOf` (Task 3), `listCodes` (`src/codes/repository.ts`), `SyncStatus` (`src/components/SyncStatus.tsx`), `useSession`·`useSync` (`src/store/`)
- Produces: `CalendarPage` (default export)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/calendar/CalendarPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import CalendarPage from './CalendarPage.tsx'

const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const TODAY = kstDate(new Date())

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.bookNotes.clear()
  await db.expenseCategories.clear()
  await db.codes.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon: () => {}, stop: () => {},
  })
})

const draw = () => render(<MemoryRouter><CalendarPage /></MemoryRouter>)

const workoutOn = (occurredOn: string, name: string) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  occurredOn, kind: 'STRENGTH', name, bodyPart: null,
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, updatedAt: '2026-08-14 12:00:00.000', deletedAt: null,
} as never)

describe('캘린더 화면', () => {
  it('이번 달을 열고 오늘을 선택해 둔다', async () => {
    await workoutOn(TODAY, '오늘운동')

    draw()

    expect(await screen.findByText('오늘운동')).toBeInTheDocument()
  })

  it('초기 동기화 전에는 불러오는 중이라고 알린다', async () => {
    useSync.setState({ initialSyncDone: false })

    draw()

    expect(await screen.findByText('기록을 불러오는 중입니다…')).toBeInTheDocument()
  })

  // 월을 넘기고 나서도 앞 달의 선택이 남으면, 격자와 요약이 서로 다른
  // 달을 가리키는 상태가 된다.
  it('월을 넘기면 선택을 해제한다', async () => {
    await workoutOn(TODAY, '오늘운동')

    draw()
    expect(await screen.findByText('오늘운동')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '이전 달' }))

    await waitFor(() => {
      expect(screen.getByText('날짜를 선택하세요.')).toBeInTheDocument()
    })
    expect(screen.queryByText('오늘운동')).not.toBeInTheDocument()
  })

  it('날짜를 누르면 그날 요약으로 바뀐다', async () => {
    const first = `${TODAY.slice(0, 7)}-01`
    await workoutOn(first, '1일운동')
    await workoutOn(TODAY, '오늘운동')

    draw()
    expect(await screen.findByText('오늘운동')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^\d+월 1일/ }))

    expect(await screen.findByText('1일운동')).toBeInTheDocument()
    // 1일이 오늘이면 둘이 같은 날이라 이 단언이 성립하지 않는다.
    if (first !== TODAY) {
      expect(screen.queryByText('오늘운동')).not.toBeInTheDocument()
    }
  })

  it('오늘 버튼은 이번 달로 돌아오며 오늘을 고른다', async () => {
    await workoutOn(TODAY, '오늘운동')

    draw()
    expect(await screen.findByText('오늘운동')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '이전 달' }))
    await waitFor(() => {
      expect(screen.getByText('날짜를 선택하세요.')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '오늘' }))

    expect(await screen.findByText('오늘운동')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/CalendarPage.test.tsx`
Expected: FAIL — `./CalendarPage.tsx`를 찾지 못한다.

- [ ] **Step 3: `CalendarPage.tsx`를 구현한다**

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CODE_GROUP, kstDate } from '@daily/shared'
import { listCodes } from '../../codes/repository.ts'
import SyncStatus from '../../components/SyncStatus.tsx'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import DaySummary from './DaySummary.tsx'
import MonthGrid from './MonthGrid.tsx'
import { addMonths, monthLabel, monthOf } from './month.ts'
import { listCategoryNames, loadMonth, type MonthRecords } from './repository.ts'

/**
 * 일자별 기록 현황.
 *
 * 한 달을 격자로 펼치고, 날짜를 누르면 그날의 기록을 아래에 나열한다.
 * 읽기 전용이다 — 쓰기가 없어서 아웃박스도 충돌도 이 화면에는 없다.
 *
 * 월 로딩 한 번이 격자와 요약을 모두 먹인다. 날짜를 눌러도 추가 조회가
 * 일어나지 않고, 조회는 월을 넘길 때만 생긴다.
 */
export default function CalendarPage() {
  const user = useSession((s) => s.user)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const today = kstDate(new Date())
  const [month, setMonth] = useState(() => monthOf(today))
  const [selected, setSelected] = useState<string | null>(today)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 세 테이블의 변경을 deps와
  // 무관하게 스스로 추적하므로, 다른 탭에서 저장하거나 pull이 들어오면
  // 격자가 알아서 다시 그려진다.
  // 초기값에 타입을 명시한다. 빈 `new Map()`을 그냥 주면 추론이 넓어져
  // `records.get(selected)`의 반환 타입이 DaySummary의 props와 어긋난다.
  const records = useLiveQuery(
    () => loadMonth(userId, month), [userId, month], new Map() as MonthRecords,
  )
  const categoryNames = useLiveQuery(
    () => listCategoryNames(userId), [userId], new Map<string, string>(),
  )

  // 부위·강도 라벨은 codes 캐시가 갖는다. 사용자와 무관하게 통째로 받아
  // 덮어쓰는 사본이라 deps에 userId가 필요 없다.
  const bodyParts = useLiveQuery(() => listCodes(CODE_GROUP.BODY_PART), [], [])
  const intensities = useLiveQuery(() => listCodes(CODE_GROUP.INTENSITY), [], [])

  /**
   * 월을 넘기면 선택을 해제한다.
   *
   * 새 달의 1일이나 같은 일자를 대신 고르면 사용자가 고른 적 없는 날을
   * 고른 척하게 된다. 격자와 요약이 서로 다른 달을 가리키는 상태 자체를
   * 만들지 않는다.
   */
  function shiftMonth(delta: number) {
    setMonth((m) => addMonths(m, delta))
    setSelected(null)
  }

  /** 이 버튼을 누르는 의도는 "이번 달 격자를 보자"가 아니라 "오늘 뭘 기록했는지 보자"다. */
  function goToday() {
    setMonth(monthOf(today))
    setSelected(today)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">기록 현황</h1>
        <button
          type="button"
          onClick={goToday}
          className="rounded-lg border border-gray-300 px-3 py-1 text-sm"
        >
          오늘
        </button>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 빈 격자를 그대로 보여주면 기록이 사라진 것으로 읽는다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="이전 달" onClick={() => shiftMonth(-1)}
          className="px-3 py-1 text-gray-500">‹</button>
        <h2 className="text-sm font-medium text-gray-900">{monthLabel(month)}</h2>
        <button type="button" aria-label="다음 달" onClick={() => shiftMonth(1)}
          className="px-3 py-1 text-gray-500">›</button>
      </div>

      <MonthGrid
        month={month}
        records={records}
        today={today}
        selected={selected}
        onSelect={setSelected}
      />

      <section className="flex flex-col gap-2 border-t border-gray-200 pt-4">
        {selected === null ? (
          <p className="py-8 text-center text-sm text-gray-400">날짜를 선택하세요.</p>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-600">{selected}</h2>
            <DaySummary
              date={selected}
              records={records.get(selected)}
              categoryNames={categoryNames}
              bodyParts={bodyParts}
              intensities={intensities}
            />
          </>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter web test -- src/pages/calendar/CalendarPage.test.tsx`
Expected: PASS — 5개 테스트 전부

**흔한 실패 하나:** `CODE_GROUP.BODY_PART`·`CODE_GROUP.INTENSITY`가 `@daily/shared`에 없으면 `WorkoutPage.tsx`의 import를 그대로 따라 쓴다 — 그 파일이 이미 같은 두 상수를 쓰고 있다.

- [ ] **Step 5: 타입 검사**

Run: `pnpm --filter web typecheck`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/pages/calendar/CalendarPage.tsx apps/web/src/pages/calendar/CalendarPage.test.tsx
git commit -m "feat(web): 일자별 기록 현황 화면을 조립한다"
```

---

## Task 9: 라우팅과 탭바

캘린더를 홈으로 올리고 지출을 `/expenses`로 옮긴다. 이 작업까지 끝나야 화면이 실제로 보인다.

**Files:**
- Modify: `apps/web/src/App.tsx:42`
- Modify: `apps/web/src/components/TabBar.tsx:10-14`

**Interfaces:**
- Consumes: `CalendarPage` (Task 8)
- Produces: 없음

- [ ] **Step 1: `App.tsx`의 라우트를 바꾼다**

import를 더한다.

```ts
import CalendarPage from './pages/calendar/CalendarPage.tsx'
```

인증된 분기의 라우트를 다음으로 바꾼다.

```tsx
<Route path="/" element={<><CalendarPage /><TabBar /></>} />
<Route path="/expenses" element={<><ExpensePage /><TabBar /></>} />
<Route path="/books" element={<><BookListPage /><TabBar /></>} />
{/* 상세는 목록 안쪽 화면이다. 탭바를 두면 돌아올 자리를 잃는다 */}
<Route path="/books/:clientUuid" element={<BookDetailPage />} />
<Route path="/workouts" element={<><WorkoutPage /><TabBar /></>} />
<Route path="*" element={<Navigate to="/" replace />} />
```

- [ ] **Step 2: `TabBar.tsx`의 탭 배열을 바꾼다**

```ts
const TABS = [
  { to: '/', label: '홈' },
  { to: '/expenses', label: '지출' },
  { to: '/books', label: '독서' },
  { to: '/workouts', label: '운동' },
] as const
```

주석의 "일기·식사가 붙으면 이 배열에 한 줄씩 더한다"는 그대로 둔다.

- [ ] **Step 3: 웹 테스트 전체를 돌린다**

Run: `pnpm --filter web test`
Expected: PASS — 전부. 실패하는 것이 있으면 라우팅 변경에 딸린 것이므로 그 테스트를 새 경로에 맞춰 고친다.

- [ ] **Step 4: 타입 검사와 빌드**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: 오류 없음

- [ ] **Step 5: 개발 서버로 눈으로 확인한다**

Run: `pnpm --filter web dev`

확인할 것:
- `/`에 캘린더가 뜨고 오늘이 선택되어 있다
- 기록이 있는 날에 점이 찍힌다
- 다른 날을 누르면 아래 요약이 바뀐다
- `‹`/`›`로 월을 넘기면 "날짜를 선택하세요."가 뜬다
- "오늘"을 누르면 이번 달 오늘로 돌아온다
- 요약의 "자세히"를 누르면 그 날짜가 이미 선택된 지출/운동 화면이 뜬다
- 탭바 넷이 모두 동작한다

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/App.tsx apps/web/src/components/TabBar.tsx
git commit -m "feat(web): 기록 현황을 홈으로 올리고 지출을 /expenses로 옮긴다"
```

---

## Task 10: 문서 갱신

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 현재 상태 표에 줄을 더한다**

`CLAUDE.md`의 상태 표에서 "운동 기록 화면" 줄 아래에 추가한다.

```markdown
| 일자별 기록 현황 (캘린더 홈) | 완료 |
```

- [ ] **Step 2: 설계 문서 목록에 추가한다**

"운동:" 줄 아래에 추가한다.

```markdown
현황: [2026-08-14-daily-calendar-design.md](docs/superpowers/specs/2026-08-14-daily-calendar-design.md)
```

- [ ] **Step 3: "현재 상태" 문단을 고친다**

```markdown
설계 확정. 1단계(기반·인증) 완료. 2단계는 동기화 엔진 + 지출 + 독서 + 운동 + 일자별 현황까지 완료, 일기·식사 미착수.
```

- [ ] **Step 4: 배포 주의 문단을 확인한다**

`SCHEMA_VERSION`은 5 그대로다. 이번 작업은 서버를 건드리지 않으므로 **그 문단을 고치지 않는다.**

- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: 일자별 기록 현황 완료를 현재 상태에 반영한다"
```

---

## 완료 확인

- [ ] `pnpm --filter web test` — 전부 통과
- [ ] `pnpm --filter web typecheck` — 오류 없음
- [ ] `pnpm build` — 성공
- [ ] `apps/api/`와 `packages/shared/`에 변경이 없다 (`git diff main --stat`으로 확인)
- [ ] `pages/calendar/`가 다른 `pages/<기능>/`를 임포트하지 않는다 (`grep -r "pages/" apps/web/src/pages/calendar/`가 아무것도 찾지 못해야 한다)
