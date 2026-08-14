import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

    // Dexie는 `[userId+occurredOn]` 인덱스 키가 같으면 clientUuid(무작위 UUID)
    // 오름차순으로 묶어 돌려준다 — 삽입 순서를 보장하지 않는다. LocalWorkout에는
    // 생성 순서를 되살릴 필드가 없어(생성 시각 없음, updatedAt은 네 레코드가
    // 동일) 어떤 이름이 잘리는지는 실행마다 달라진다. 그래서 "몇 번째 항목이
    // 남는지"가 아니라 "네 줄 중 세 줄까지만 남는지"를 검증한다.
    // 운동 카드로 범위를 좁힌다 — 문서 전체에서 세면 다른 카드가 나중에
    // listitem을 갖게 될 때 이 값이 조용히 부풀어도 이 테스트는 그대로
    // 통과해버린다.
    const workoutCard = screen.getByRole('link', { name: /운동/ })
    expect(await within(workoutCard).findAllByRole('listitem')).toHaveLength(3)
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
