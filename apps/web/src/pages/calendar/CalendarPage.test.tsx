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
