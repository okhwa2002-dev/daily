# 마이 탭 레이아웃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하단 탭을 홈·마이 둘로 줄이고, 지출·독서·운동을 마이 화면의 카드 세 장(오늘 기준 요약 → 등록 화면 이동)으로 내린다.

**Architecture:** `pages/my/`가 자기 Dexie 질의(`loadToday`)로 오늘의 지출·운동과 읽는 중인 책을 한 번에 읽어 카드 세 장을 먹인다. 지출·독서·운동 화면은 라우트는 그대로인 채 탭바를 잃고 공용 `BackHeader`로 뒤로 간다. 서버·DB 변경은 없다.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Dexie + dexie-react-hooks, react-router, vitest + @testing-library/react

**Spec:** [docs/superpowers/specs/2026-08-14-my-tab-layout-design.md](../specs/2026-08-14-my-tab-layout-design.md)

## Global Constraints

- 작업 디렉터리는 `d:\workspace\ok2020\daily`, 브랜치는 `feat/daily-calendar`.
- 테스트 명령은 `pnpm --filter web test`. 단일 파일은 `pnpm --filter web test -- src/경로/파일.test.tsx`.
- **화면은 로컬 Dexie만 읽는다.** API를 직접 호출하지 않는다.
- **`pages/<기능>/` 폴더는 다른 `pages/<기능>/` 폴더를 임포트하지 않는다.** `src/db/`·`src/lib/`·`src/components/`·`src/codes/`는 공용 자리이므로 임포트해도 된다.
- **툼스톤은 항상 `live()`로 걷어낸다.** 모든 조회에 `userId` 조건을 건다.
- 금액은 문자열 또는 최소 단위 정수(`bigint`)로만 다룬다. 부동소수점 연산 금지. `src/lib/money.ts`의 `toMinorUnits`·`formatMinorUnits`를 쓴다.
- 코드성 값은 대문자다 (`'READING'`, `'INCOME'`, `'EXPENSE'`).
- 커밋 메시지는 한국어 현재형 (`feat(web): …를 …한다`). 기존 히스토리 형식을 따른다.
- DB 마이그레이션·API 라우트 추가·`SCHEMA_VERSION` 인상 없음.

---

## File Structure

```
apps/web/src/
├── components/
│   ├── TabBar.tsx          [수정] 탭 배열을 홈·마이 둘로
│   ├── TabBar.test.tsx     [신규]
│   ├── BackHeader.tsx      [신규] ‹ 뒤로 + 제목
│   └── BackHeader.test.tsx [신규]
├── pages/my/
│   ├── repository.ts       [신규] loadToday — 오늘 지출·운동 + READING 책
│   ├── repository.test.ts  [신규]
│   ├── SummaryCard.tsx     [신규] 카드 한 장의 껍데기 (링크·제목·요약·미리보기)
│   ├── SummaryCard.test.tsx[신규]
│   ├── MyPage.tsx          [신규] 데이터 구독, 카드 조립, 계정 영역
│   └── MyPage.test.tsx     [신규]
├── pages/expense/ExpensePage.tsx  [수정] BackHeader, 로그아웃 제거, pb-20 제거
├── pages/book/BookListPage.tsx    [수정] BackHeader, pb-20 제거
├── pages/workout/WorkoutPage.tsx  [수정] BackHeader, pb-20 제거
└── App.tsx                        [수정] /my 추가, 세 라우트에서 TabBar 제거
CLAUDE.md                          [수정] 설계 문서 목록에 스펙 추가
```

`SummaryCard`를 `MyPage`에서 분리하는 이유는 카드 세 장이 안쪽 내용만 다르고 껍데기가 같기 때문이다. 카드가 링크라는 사실(누르는 영역, 화살표 위치, 빈 상태 문구 자리)이 세 곳에 복사되면 일기·식사가 붙을 때 다섯 벌이 된다.

---

### Task 1: `pages/my/repository.ts` — 오늘 기록 조회

**Files:**
- Create: `apps/web/src/pages/my/repository.ts`
- Test: `apps/web/src/pages/my/repository.test.ts`

**Interfaces:**
- Consumes: `db`, `live`, `LocalBook`, `LocalExpense`, `LocalWorkout` (`apps/web/src/db/index.ts`)
- Produces:
  - `interface TodayRecords { expenses: LocalExpense[]; workouts: LocalWorkout[]; readingBooks: LocalBook[] }`
  - `const EMPTY_TODAY: TodayRecords`
  - `loadToday(userId: number, date: string): Promise<TodayRecords>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/my/repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/index.ts'
import { loadToday } from './repository.ts'

const USER = 1
const OTHER = 2
const TODAY = '2026-08-14'

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.books.clear()
})

const expense = (over: Record<string, unknown> = {}) => db.expenses.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: TODAY, kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const workout = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
  bodyPart: null, sets: [{ reps: 10, weightKg: 60 }], durationMin: null,
  intensity: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const book = (over: Record<string, unknown> = {}) => db.books.put({
  clientUuid: crypto.randomUUID(), userId: USER, serverId: null,
  title: '클린 코드', author: null, summary: null, status: 'READING',
  startedOn: null, finishedOn: null, genre: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

describe('loadToday', () => {
  it('오늘의 지출·운동과 읽는 중인 책을 함께 돌려준다', async () => {
    await expense()
    await workout()
    await book()

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(1)
    expect(records.workouts).toHaveLength(1)
    expect(records.readingBooks).toHaveLength(1)
  })

  it('기록이 하나도 없으면 빈 배열 셋이다', async () => {
    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toEqual([])
    expect(records.workouts).toEqual([])
    expect(records.readingBooks).toEqual([])
  })

  it('다른 날짜의 지출·운동을 섞지 않는다', async () => {
    await expense({ occurredOn: '2026-08-13', memo: '어제' })
    await expense({ occurredOn: '2026-08-15', memo: '내일' })
    await workout({ occurredOn: '2026-08-13', name: '어제운동' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(0)
    expect(records.workouts).toHaveLength(0)
  })

  // 독서 카드는 날짜 축이 아니다. 오늘 감상평을 안 썼다고 읽는 중인 책이
  // 사라지면 카드가 빈 것으로 보인다.
  it('읽는 중인 책은 날짜와 무관하게 잡는다', async () => {
    await book({ title: '오래된 책', updatedAt: '2020-01-01 00:00:00.000' })

    const records = await loadToday(USER, TODAY)

    expect(records.readingBooks).toHaveLength(1)
    expect(records.readingBooks[0]?.title).toBe('오래된 책')
  })

  it('READING이 아닌 책은 뺀다', async () => {
    await book({ title: '읽는 중', status: 'READING' })
    await book({ title: '다 읽음', status: 'DONE' })
    await book({ title: '읽고 싶음', status: 'WISHLIST' })

    const records = await loadToday(USER, TODAY)

    expect(records.readingBooks).toHaveLength(1)
    expect(records.readingBooks[0]?.title).toBe('읽는 중')
  })

  it('툼스톤을 제외한다', async () => {
    await expense({ memo: '살아있음' })
    await expense({ memo: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })
    await workout({ name: '살아있음', })
    await workout({ name: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })
    await book({ title: '살아있음' })
    await book({ title: '지워짐', deletedAt: '2026-08-14 13:00:00.000' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(1)
    expect(records.workouts).toHaveLength(1)
    expect(records.readingBooks).toHaveLength(1)
  })

  it('다른 사용자의 기록을 섞지 않는다', async () => {
    await expense({ userId: OTHER, memo: '남의 것' })
    await workout({ userId: OTHER, name: '남의 운동' })
    await book({ userId: OTHER, title: '남의 책' })

    const records = await loadToday(USER, TODAY)

    expect(records.expenses).toHaveLength(0)
    expect(records.workouts).toHaveLength(0)
    expect(records.readingBooks).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/repository.test.ts`
Expected: FAIL — `Failed to resolve import "./repository.ts"`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/web/src/pages/my/repository.ts`:

```ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/repository.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/pages/my/repository.ts apps/web/src/pages/my/repository.test.ts
git commit -m "feat(web): 마이 화면이 오늘 기록을 읽는 통로를 만든다"
```

---

### Task 2: `components/BackHeader.tsx` — 안쪽 화면의 뒤로 가기

**Files:**
- Create: `apps/web/src/components/BackHeader.tsx`
- Test: `apps/web/src/components/BackHeader.test.tsx`

**Interfaces:**
- Consumes: `useLocation`, `useNavigate` (`react-router`)
- Produces: `export default function BackHeader({ title }: { title: string })` — `<header>` 안에 `aria-label="뒤로"` 버튼과 `<h1>{title}</h1>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/components/BackHeader.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import BackHeader from './BackHeader.tsx'

const draw = (entries: string[]) => render(
  <MemoryRouter initialEntries={entries}>
    <Routes>
      <Route path="/expenses" element={<BackHeader title="지출" />} />
      <Route path="/my" element={<p>마이 화면</p>} />
      <Route path="/" element={<p>홈 화면</p>} />
    </Routes>
  </MemoryRouter>,
)

describe('BackHeader', () => {
  it('제목을 제목 요소로 보여준다', () => {
    draw(['/expenses'])

    expect(screen.getByRole('heading', { name: '지출' })).toBeInTheDocument()
  })

  // 홈의 '자세히'를 눌러 들어온 사용자는 홈으로 돌아가야 한다.
  it('히스토리가 있으면 직전 화면으로 돌아간다', async () => {
    draw(['/', '/expenses'])

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))

    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  // PWA를 새로 열거나 북마크로 직접 들어오면 뒤로 갈 곳이 없다.
  // navigate(-1)이면 앱 밖으로 나간다.
  it('히스토리가 없으면 마이로 올려보낸다', async () => {
    draw(['/expenses'])

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))

    expect(await screen.findByText('마이 화면')).toBeInTheDocument()
  })
})
```

`MemoryRouter`는 `initialEntries`의 첫 항목에만 `location.key = 'default'`를 준다. 그래서 `['/expenses']`는 히스토리 없음, `['/', '/expenses']`는 히스토리 있음으로 각각 실제 동작을 검증한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter web test -- src/components/BackHeader.test.tsx`
Expected: FAIL — `Failed to resolve import "./BackHeader.tsx"`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/web/src/components/BackHeader.tsx`:

```tsx
import { useLocation, useNavigate } from 'react-router'

/**
 * 마이 탭 안쪽 화면의 헤더.
 *
 * 지출·독서·운동은 탭이 아니라 마이 탭 안쪽 화면이라 탭바가 없다. 대신
 * 이 헤더가 나갈 길을 갖는다.
 *
 * `BookDetailPage`는 이 컴포넌트를 쓰지 않는다 — 헤더에 제목이 없고
 * 오른쪽에 수정·삭제 버튼이 붙는 다른 모양이다.
 */
interface Props {
  title: string
}

export default function BackHeader({ title }: Props) {
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * 히스토리 스택의 첫 항목이면 `key`가 `'default'`다.
   *
   * 뒤로 갈 곳이 없는데 `navigate(-1)`을 부르면 앱 밖으로 나간다 — PWA를
   * 새로 열거나 북마크로 직접 들어온 경우가 그렇다. 반대로 `/my` 하나로
   * 고정하면 홈의 '자세히'로 들어온 사용자가 홈이 아닌 마이에 떨어진다.
   * 두 경우가 다 생기므로 둘 다 다룬다.
   */
  function goBack() {
    if (location.key === 'default') void navigate('/my')
    else void navigate(-1)
  }

  return (
    <header className="flex items-center gap-1">
      <button
        type="button"
        onClick={goBack}
        aria-label="뒤로"
        className="-ml-2 px-2 py-1 text-xl leading-none text-gray-500"
      >
        ‹
      </button>
      <h1 className="text-xl font-semibold">{title}</h1>
    </header>
  )
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/components/BackHeader.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/components/BackHeader.tsx apps/web/src/components/BackHeader.test.tsx
git commit -m "feat(web): 안쪽 화면이 쓸 뒤로 가기 헤더를 만든다"
```

---

### Task 3: `pages/my/SummaryCard.tsx` — 카드 껍데기

**Files:**
- Create: `apps/web/src/pages/my/SummaryCard.tsx`
- Test: `apps/web/src/pages/my/SummaryCard.test.tsx`

**Interfaces:**
- Consumes: `Link` (`react-router`)
- Produces: `export default function SummaryCard({ title, summary, to, lines, empty }: Props)` — Props는 전부 필수, `lines: string[]`, 나머지는 `string`. 카드 전체가 `to`로 가는 링크다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/my/SummaryCard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SummaryCard from './SummaryCard.tsx'

const draw = (over: Partial<Parameters<typeof SummaryCard>[0]> = {}) => render(
  <MemoryRouter>
    <SummaryCard
      title="지출"
      summary="-32,000원"
      to="/expenses?date=2026-08-14"
      lines={['-12,000원 · 점심 김밥']}
      empty="오늘 기록이 없습니다"
      {...over}
    />
  </MemoryRouter>,
)

describe('SummaryCard', () => {
  it('제목·요약·미리보기를 보여준다', () => {
    draw()

    expect(screen.getByText('지출')).toBeInTheDocument()
    expect(screen.getByText('-32,000원')).toBeInTheDocument()
    expect(screen.getByText('-12,000원 · 점심 김밥')).toBeInTheDocument()
  })

  // 카드가 곧 등록 화면 입구다. 카드 전체가 눌려야 한다.
  it('카드 전체가 목적지로 가는 링크다', () => {
    draw()

    const link = screen.getByRole('link', { name: /지출/ })
    expect(link).toHaveAttribute('href', '/expenses?date=2026-08-14')
  })

  it('미리보기가 비면 안내 문구를 대신 보여준다', () => {
    draw({ lines: [] })

    expect(screen.getByText('오늘 기록이 없습니다')).toBeInTheDocument()
  })

  // 독서 카드만 날짜 축이 아니라 '오늘'이 붙으면 틀린 말이 된다.
  it('안내 문구는 카드마다 다르게 넣을 수 있다', () => {
    draw({ lines: [], empty: '읽는 중인 책이 없습니다' })

    expect(screen.getByText('읽는 중인 책이 없습니다')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/SummaryCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./SummaryCard.tsx"`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/web/src/pages/my/SummaryCard.tsx`:

```tsx
import { Link } from 'react-router'

/**
 * 마이 화면의 카드 한 장.
 *
 * 세 카드가 안쪽 내용만 다르고 껍데기가 같다. 카드가 링크라는 사실을
 * 세 곳에 복사하면 일기·식사가 붙을 때 다섯 벌이 된다.
 *
 * **기록이 없어도 카드를 지우지 않는다.** 카드가 곧 등록 화면으로 가는
 * 입구라서, 카드가 사라지면 기록하러 들어갈 길도 같이 사라진다.
 */
interface Props {
  title: string
  /** 제목 오른쪽 집계 한 조각 */
  summary: string
  to: string
  /** 미리보기 줄. 이미 상한까지 잘라서 넘긴다 */
  lines: string[]
  /** `lines`가 비었을 때 대신 보여줄 문구 */
  empty: string
}

export default function SummaryCard({ title, summary, to, lines, empty }: Props) {
  return (
    <Link to={to} className="flex flex-col gap-1 rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-gray-900">{title}</h2>
        <span className="flex items-baseline gap-1 text-sm text-gray-600">
          {summary}
          <span aria-hidden="true" className="text-gray-400">›</span>
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <li key={line} className="truncate text-sm text-gray-600">{line}</li>
          ))}
        </ul>
      )}
    </Link>
  )
}
```

`key={line}`은 같은 문자열 두 줄이 나오면 React가 경고한다. 실제로 같은 금액·같은 메모의 지출을 두 건 넣으면 생길 수 있으므로, 경고가 뜨면 Task 4에서 줄 문자열에 인덱스를 섞지 말고 `key`만 `` `${i}-${line}` ``로 바꾼다 — 화면에 보이는 문자열은 그대로 둔다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/SummaryCard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/pages/my/SummaryCard.tsx apps/web/src/pages/my/SummaryCard.test.tsx
git commit -m "feat(web): 마이 화면 카드 껍데기를 만든다"
```

---

### Task 4: `pages/my/MyPage.tsx` — 카드 조립과 계정 영역

**Files:**
- Create: `apps/web/src/pages/my/MyPage.tsx`
- Test: `apps/web/src/pages/my/MyPage.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1의 `loadToday`, `EMPTY_TODAY`
  - Task 3의 `SummaryCard`
  - `kstDate` (`@daily/shared`), `formatMinorUnits`·`toMinorUnits` (`../../lib/money.ts`)
  - `SyncStatus` (`../../components/SyncStatus.tsx`), `useSession`, `useSync`, `logoutSafely` (`../../sync/logout.ts`)
- Produces: `export default function MyPage()`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/pages/my/MyPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import MyPage from './MyPage.tsx'

const USER = { id: 1, email: 'a@example.com' }
const TODAY = kstDate(new Date())

beforeEach(async () => {
  await db.expenses.clear()
  await db.workouts.clear()
  await db.books.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon: () => {}, stop: () => {},
  })
})

const draw = () => render(<MemoryRouter><MyPage /></MemoryRouter>)

const expense = (over: Record<string, unknown> = {}) => db.expenses.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  occurredOn: TODAY, kind: 'EXPENSE', amount: '12000',
  categoryClientUuid: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const workout = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
  bodyPart: null, sets: [{ reps: 10, weightKg: 60 }], durationMin: null,
  intensity: null, memo: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

const book = (over: Record<string, unknown> = {}) => db.books.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  title: '클린 코드', author: null, summary: null, status: 'READING',
  startedOn: null, finishedOn: null, genre: null,
  updatedAt: '2026-08-14 12:00:00.000', deletedAt: null, ...over,
} as never)

describe('마이 화면', () => {
  it('지출·독서·운동 순으로 카드 세 장을 놓는다', async () => {
    draw()

    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['지출', '독서', '운동'])
  })

  it('오늘 지출 합계를 보여준다 — 수입은 더하고 지출은 뺀다', async () => {
    await expense({ amount: '12000', kind: 'EXPENSE' })
    await expense({ amount: '50000', kind: 'INCOME' })

    draw()

    expect(await screen.findByText('38,000원')).toBeInTheDocument()
  })

  it('지출 미리보기는 금액이 이끌고 메모는 있을 때만 붙는다', async () => {
    await expense({ amount: '12000', memo: '점심 김밥' })
    await expense({ amount: '3000', memo: null })

    draw()

    expect(await screen.findByText('-12,000원 · 점심 김밥')).toBeInTheDocument()
    expect(screen.getByText('-3,000원')).toBeInTheDocument()
  })

  it('읽는 중인 책 권수와 제목을 보여준다', async () => {
    await book({ title: '클린 코드' })
    await book({ title: '리팩터링' })
    await book({ title: '다 읽음', status: 'DONE' })

    draw()

    expect(await screen.findByText('읽는 중 2권')).toBeInTheDocument()
    expect(screen.getByText('클린 코드')).toBeInTheDocument()
    expect(screen.queryByText('다 읽음')).not.toBeInTheDocument()
  })

  it('오늘 운동 건수와 이름을 보여준다', async () => {
    await workout({ name: '벤치프레스' })
    await workout({ name: '스쿼트' })

    draw()

    expect(await screen.findByText('2건')).toBeInTheDocument()
    expect(screen.getByText('벤치프레스')).toBeInTheDocument()
  })

  it('미리보기는 세 줄까지만 보여준다', async () => {
    for (const name of ['하나', '둘', '셋', '넷']) await workout({ name })

    draw()

    expect(await screen.findByText('하나')).toBeInTheDocument()
    expect(screen.queryByText('넷')).not.toBeInTheDocument()
  })

  // 카드가 사라지면 기록하러 들어갈 입구도 같이 사라진다.
  it('기록이 없어도 카드를 남기고 안내 문구를 넣는다', async () => {
    draw()

    expect(await screen.findAllByText('오늘 기록이 없습니다')).toHaveLength(2)
    expect(screen.getByText('읽는 중인 책이 없습니다')).toBeInTheDocument()
  })

  it('지출·운동 카드는 오늘 날짜를 들고 가고 독서는 날짜가 없다', async () => {
    draw()

    const links = await screen.findAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/expenses?date=${TODAY}`,
      '/books',
      `/workouts?date=${TODAY}`,
    ])
  })

  it('초기 동기화 전에는 불러오는 중이라고 알린다', async () => {
    useSync.setState({ initialSyncDone: false })

    draw()

    expect(await screen.findByText('기록을 불러오는 중입니다…')).toBeInTheDocument()
  })

  it('계정 영역에 이메일과 로그아웃을 둔다', async () => {
    draw()

    expect(await screen.findByText('a@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument()
  })

  it('큐가 비어 있으면 확인 없이 로그아웃한다', async () => {
    const logout = vi.fn(async () => {})
    useSession.setState({ logout })

    draw()
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(logout).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/MyPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./MyPage.tsx"`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/web/src/pages/my/MyPage.tsx`:

```tsx
import { useLiveQuery } from 'dexie-react-hooks'
import { kstDate } from '@daily/shared'
import SyncStatus from '../../components/SyncStatus.tsx'
import type { LocalExpense } from '../../db/index.ts'
import { formatMinorUnits, toMinorUnits } from '../../lib/money.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { logoutSafely } from '../../sync/logout.ts'
import SummaryCard from './SummaryCard.tsx'
import { EMPTY_TODAY, loadToday } from './repository.ts'

/** 카드 한 장이 보여줄 미리보기 줄 수 */
const PREVIEW = 3

/**
 * 마이 — 기능별 기록 입구.
 *
 * 홈(캘린더)이 "언제 뭘 기록했나"를 날짜 축으로 묻는다면 여기는 "오늘 뭘
 * 기록했고 지금 뭘 기록할까"를 기능 축으로 묻는다. 그래서 항상 오늘만
 * 본다 — 날짜 선택기를 두면 캘린더와 같은 화면이 두 개가 된다.
 *
 * 읽기 전용이다. 등록·수정·삭제는 카드를 눌러 들어간 기능 화면이 계속
 * 담당한다.
 */
export default function MyPage() {
  const user = useSession((s) => s.user)
  const logout = useSession((s) => s.logout)
  const stopSync = useSync((s) => s.stop)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const today = kstDate(new Date())

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 세 테이블의 변경을 스스로
  // 추적하므로, 기능 화면에서 저장하고 돌아오면 카드가 알아서 갱신된다.
  const records = useLiveQuery(() => loadToday(userId, today), [userId, today], EMPTY_TODAY)

  // 수입은 더하고 지출은 뺀다. 부동소수점을 거치지 않으려고 최소 단위
  // 정수로 계산한다.
  const total = records.expenses.reduce((sum, e) => {
    const value = toMinorUnits(e.amount)
    return e.kind === 'INCOME' ? sum + value : sum - value
  }, 0n)

  async function handleLogout() {
    const outcome = await logoutSafely({
      userId,
      logout,
      confirmDiscard: (pending) => window.confirm(
        `동기화되지 않은 기록 ${pending}건이 있습니다.\n`
        + '지금 로그아웃하면 이 기록은 사라집니다. 계속할까요?',
      ),
    })
    if (outcome === 'DONE') stopSync()
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-20">
      <header>
        <h1 className="text-xl font-semibold">마이</h1>
      </header>

      <SyncStatus />

      {!initialSyncDone && (
        // 완료 전 빈 카드를 그대로 보여주면 기록이 사라진 것으로 읽는다.
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      <div className="flex flex-col gap-3">
        <SummaryCard
          title="지출"
          summary={formatMinorUnits(total)}
          to={`/expenses?date=${today}`}
          empty="오늘 기록이 없습니다"
          lines={records.expenses.slice(0, PREVIEW).map(expenseLine)}
        />
        <SummaryCard
          title="독서"
          summary={`읽는 중 ${records.readingBooks.length}권`}
          to="/books"
          empty="읽는 중인 책이 없습니다"
          lines={records.readingBooks.slice(0, PREVIEW).map((b) => b.title)}
        />
        <SummaryCard
          title="운동"
          summary={`${records.workouts.length}건`}
          to={`/workouts?date=${today}`}
          empty="오늘 기록이 없습니다"
          lines={records.workouts.slice(0, PREVIEW).map((w) => w.name)}
        />
      </div>

      <section className="mt-auto flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <span className="min-w-0 truncate text-sm text-gray-600">{user?.email}</span>
        <button type="button" onClick={() => void handleLogout()} className="shrink-0 text-sm underline">
          로그아웃
        </button>
      </section>
    </main>
  )
}

/**
 * 미리보기 한 줄. 금액이 이끌고 메모는 있을 때만 붙는다.
 *
 * 메모가 있는 항목만 줄로 뽑으면 지출은 기록했는데 메모를 안 단 사용자에게
 * 카드가 빈 것으로 보인다 — "오늘 기록이 없습니다"라는 거짓말이 된다.
 * 금액은 모든 항목이 반드시 갖는다.
 */
function expenseLine(e: LocalExpense): string {
  const value = toMinorUnits(e.amount)
  const amount = formatMinorUnits(e.kind === 'INCOME' ? value : -value)
  return e.memo ? `${amount} · ${e.memo}` : amount
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/pages/my/MyPage.test.tsx`
Expected: PASS (11 tests)

`key` 중복 경고가 콘솔에 뜨면 Task 3 Step 3에 적은 대로 `SummaryCard`의 `key`만 `` `${i}-${line}` ``로 바꾸고 그 파일 테스트를 다시 돌린다.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/pages/my/MyPage.tsx apps/web/src/pages/my/MyPage.test.tsx
git commit -m "feat(web): 마이 화면을 조립한다"
```

---

### Task 5: 탭바와 라우팅 — 홈·마이 둘로 줄인다

**Files:**
- Modify: `apps/web/src/components/TabBar.tsx:10-15`
- Create: `apps/web/src/components/TabBar.test.tsx`
- Modify: `apps/web/src/App.tsx:41-50`

**Interfaces:**
- Consumes: Task 4의 `MyPage`
- Produces: `/my` 라우트. `/expenses`·`/books`·`/workouts`는 탭바 없이 렌더된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/components/TabBar.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import TabBar from './TabBar.tsx'

const draw = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><TabBar /></MemoryRouter>,
)

describe('TabBar', () => {
  it('탭은 홈과 마이 둘뿐이다', () => {
    draw('/')

    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['홈', '마이'])
  })

  it('지출·독서·운동은 탭이 아니다', () => {
    draw('/')

    expect(screen.queryByText('지출')).not.toBeInTheDocument()
    expect(screen.queryByText('독서')).not.toBeInTheDocument()
    expect(screen.queryByText('운동')).not.toBeInTheDocument()
  })

  // NavLink의 end가 빠지면 '/'가 모든 경로에서 활성으로 잡힌다.
  it('마이에서는 홈이 활성이 아니다', () => {
    draw('/my')

    expect(screen.getByRole('link', { name: '마이' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm --filter web test -- src/components/TabBar.test.tsx`
Expected: FAIL — 첫 테스트가 `['홈', '지출', '독서', '운동']`을 받아 불일치

- [ ] **Step 3: 탭 배열을 줄인다**

`apps/web/src/components/TabBar.tsx`의 주석과 `TABS`를 이렇게 바꾼다:

```tsx
/**
 * 하단 탭 내비게이션.
 *
 * 탭은 홈과 마이 둘이다. 기능이 늘어도 탭은 늘리지 않는다 — 일기·식사가
 * 붙으면 탭이 아니라 마이 화면의 카드가 한 장씩 는다.
 *
 * 화면 스택 안쪽(지출·독서·운동·책 상세)에서는 이 컴포넌트를 렌더링하지
 * 않는다. 다른 탭으로 바로 나가면 돌아올 자리를 잃고, 마이 탭 안에서
 * 마이 탭을 누르는 상태가 생긴다.
 */
const TABS = [
  { to: '/', label: '홈' },
  { to: '/my', label: '마이' },
] as const
```

`TabBar` 함수 본문과 `NavLink` 마크업은 그대로 둔다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm --filter web test -- src/components/TabBar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: 라우팅을 바꾼다**

`apps/web/src/App.tsx`에 임포트를 더한다 (`ExpensePage` 임포트 아래, 알파벳 순서상 `LoginPage` 앞):

```tsx
import MyPage from './pages/my/MyPage.tsx'
```

인증된 분기의 `<Route>` 목록을 통째로 이렇게 바꾼다:

```tsx
<Route path="/" element={<><CalendarPage /><TabBar /></>} />
<Route path="/my" element={<><MyPage /><TabBar /></>} />
{/* 아래 넷은 마이 탭 안쪽 화면이다. 탭바를 두면 돌아올 자리를 잃는다 */}
<Route path="/expenses" element={<ExpensePage />} />
<Route path="/books" element={<BookListPage />} />
<Route path="/books/:clientUuid" element={<BookDetailPage />} />
<Route path="/workouts" element={<WorkoutPage />} />
<Route path="*" element={<Navigate to="/" replace />} />
```

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `pnpm --filter web test`
Expected: PASS — 기존 페이지 테스트는 `MemoryRouter`로 각 페이지를 직접 렌더하므로 라우팅 변경에 영향을 받지 않는다. 깨지는 것이 있으면 그 파일을 열어 원인을 확인하고 고친 뒤 다시 돌린다.

- [ ] **Step 7: 커밋한다**

```bash
git add apps/web/src/components/TabBar.tsx apps/web/src/components/TabBar.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): 하단 탭을 홈과 마이 둘로 줄인다"
```

---

### Task 6: 안쪽 화면 셸 — 뒤로 가기와 여백

**Files:**
- Modify: `apps/web/src/pages/expense/ExpensePage.tsx` (임포트, `handleLogout`, `main`·`header`)
- Modify: `apps/web/src/pages/book/BookListPage.tsx:45-48`
- Modify: `apps/web/src/pages/workout/WorkoutPage.tsx:79-82`

**Interfaces:**
- Consumes: Task 2의 `BackHeader`
- Produces: 없음 (화면 셸 교체)

- [ ] **Step 1: `ExpensePage`에서 로그아웃을 걷어낸다**

`apps/web/src/pages/expense/ExpensePage.tsx`에서 아래를 지운다:

- 임포트 `import { logoutSafely } from '../../sync/logout.ts'`
- 훅 `const logout = useSession((s) => s.logout)`
- 훅 `const stopSync = useSync((s) => s.stop)`
- 함수 `handleLogout` 전체 (62-72행)

`useSession`·`useSync` 임포트 자체는 남는다 — `user`, `syncSoon`, `initialSyncDone`을 계속 쓴다.

- [ ] **Step 2: 세 화면의 헤더를 `BackHeader`로 바꾼다**

세 파일 모두 `SyncStatus` 임포트 바로 위에 더한다:

```tsx
import BackHeader from '../../components/BackHeader.tsx'
```

`ExpensePage`의 `<header>` 블록(76-81행)을 이 한 줄로 바꾼다:

```tsx
<BackHeader title="지출" />
```

`BookListPage`의 `<header>` 블록(46-48행):

```tsx
<BackHeader title="독서" />
```

`WorkoutPage`의 `<header>` 블록(80-82행):

```tsx
<BackHeader title="운동" />
```

- [ ] **Step 3: 하단 여백을 뺀다**

세 파일의 `<main>` className에서 `pb-20`만 지운다. 탭바가 없는데 여백이 남으면 목록 끝에 빈 공간이 뜬다.

```tsx
<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
```

`CalendarPage`와 `MyPage`의 `pb-20`은 그대로 둔다 — 그 둘에는 탭바가 있다.

- [ ] **Step 4: 전체 테스트를 돌린다**

Run: `pnpm --filter web test`
Expected: PASS — 세 화면 테스트는 `<h1>` 텍스트로 화면을 찾지 않고 각자 폼·목록 요소를 보므로 헤더 교체에 영향을 받지 않는다. 셀렉터가 깨지는 것이 있으면 `screen.getByRole('heading', { name: '지출' })` 같은 형태로 고친다.

- [ ] **Step 5: 타입 검사와 빌드를 돌린다**

Run: `pnpm --filter web build`
Expected: 성공. `ExpensePage`에서 지운 `logoutSafely`·`stopSync`가 어딘가 남아 있으면 여기서 잡힌다.

- [ ] **Step 6: 커밋한다**

```bash
git add apps/web/src/pages/expense/ExpensePage.tsx apps/web/src/pages/book/BookListPage.tsx apps/web/src/pages/workout/WorkoutPage.tsx
git commit -m "feat(web): 지출·독서·운동을 마이 탭 안쪽 화면으로 내린다"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** 없음

- [ ] **Step 1: 설계 문서 목록에 스펙을 더한다**

`CLAUDE.md`의 "현재 상태" 절, `현황:` 줄 바로 아래에 더한다:

```markdown
마이 탭: [2026-08-14-my-tab-layout-design.md](docs/superpowers/specs/2026-08-14-my-tab-layout-design.md)
```

기능 상태표는 건드리지 않는다 — 지출·독서·운동은 그대로 완료고, 이번 작업은 그 화면들에 닿는 경로만 바꿨다.

- [ ] **Step 2: 커밋한다**

```bash
git add CLAUDE.md
git commit -m "docs: 마이 탭 설계 문서를 안내에 더한다"
```

---

### Task 8: 실제 앱에서 확인

**Files:** 없음 (수동 확인)

- [ ] **Step 1: 개발 서버를 띄운다**

Run: `pnpm --filter web dev`

- [ ] **Step 2: 아래를 차례로 확인한다**

1. 하단 탭이 홈·마이 둘뿐이다.
2. 마이 탭에 지출 → 독서 → 운동 순으로 카드 세 장이 있고, 기록이 없는 카드도 안내 문구와 함께 남아 있다.
3. 지출 카드를 누르면 지출 화면으로 가고 날짜가 오늘로 잡혀 있다. 하단 탭바가 없다.
4. 지출 화면의 `‹ 뒤로`를 누르면 마이로 돌아온다.
5. 홈에서 오늘을 고르고 지출 섹션의 "자세히"로 들어간 뒤 `‹ 뒤로`를 누르면 **마이가 아니라 홈으로** 돌아온다.
6. 지출 화면 URL(`/expenses`)로 브라우저를 새로고침한 뒤 `‹ 뒤로`를 누르면 마이로 간다 (앱 밖으로 나가지 않는다).
7. 마이 화면 아래 계정 영역에 이메일과 로그아웃이 있고, 로그아웃이 동작한다.
8. 지출 화면에 로그아웃 버튼이 더 이상 없다.

- [ ] **Step 3: 어긋나는 것이 있으면 고치고 커밋한다**

전부 맞으면 커밋할 것이 없다.

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §1 목표·캘린더와의 역할 구분 | Task 4 (오늘 고정, 날짜 선택기 없음) |
| §1 서버 작업 없음 | 전 태스크 — DB·API 변경 없음 |
| §2 라우팅 표 | Task 5 |
| §2 `BackHeader` 동작 (`location.key`) | Task 2 |
| §2 `BookDetailPage` 제외 | Task 5 Step 5 (라우트만 유지), Task 6 (건드리지 않음) |
| §2 탭바 배열 | Task 5 |
| §3 파일 구조 | Task 1·3·4 |
| §3 `loadToday` | Task 1 |
| §3 카드 내용 표 | Task 4 |
| §3 지출 미리보기가 금액을 이끈다 | Task 4 (`expenseLine`) |
| §3 카테고리·코드 라벨 미조회 | Task 1·4 — `listCodes`·카테고리 조회 없음 |
| §3 빈 카드 유지와 카드별 문구 | Task 3·4 |
| §3 계정 영역 (이메일·로그아웃 이관) | Task 4·6 |
| §3 로딩 배너 | Task 4 |
| §3 여백 (`pb-20`) | Task 4·6 |
| §3 문서 갱신 | Task 7 |
| §4 테스트 표 | Task 1·2·3·4·5 |
| §5 범위 밖 | 해당 태스크 없음 — 의도한 것 |

**타입 일관성**

- `TodayRecords`의 필드명(`expenses`·`workouts`·`readingBooks`)이 Task 1 정의와 Task 4 사용처에서 같다.
- `EMPTY_TODAY`는 Task 1에서 export하고 Task 4에서 `useLiveQuery` 초기값으로 쓴다.
- `SummaryCard`의 Props 다섯(`title`·`summary`·`to`·`lines`·`empty`)이 Task 3 정의와 Task 4 호출부에서 같다.
- `BackHeader`는 Task 2에서 `title` 하나만 받고 Task 6의 세 호출부가 그대로 따른다.
- `loadToday(userId, date)` 인자 순서가 Task 1 테스트·구현과 Task 4 호출부에서 같다.

**플레이스홀더**: 없음. 모든 코드 단계에 실제 코드가 들어 있다.
