import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import { takeBatch } from '../../sync/outbox.ts'
import WorkoutPage from './WorkoutPage.tsx'

const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const TODAY = kstDate(new Date())

const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.workouts.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

const put = (over: Record<string, unknown> = {}) => db.workouts.put({
  clientUuid: crypto.randomUUID(), userId: USER.id, serverId: null,
  occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스', bodyPart: 'CHEST',
  sets: [{ reps: 10, weightKg: 60 }], durationMin: null, intensity: null,
  memo: null, updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
  ...over,
} as never)

describe('운동 화면', () => {
  it('그날의 기록을 보여준다', async () => {
    await put({ name: '벤치프레스' })
    await put({ occurredOn: '2026-01-01', name: '작년운동' })

    render(<WorkoutPage />)

    expect(await screen.findByText('벤치프레스')).toBeInTheDocument()
    expect(screen.queryByText('작년운동')).not.toBeInTheDocument()
  })

  it('근력은 세트를 요약해 보여준다', async () => {
    await put({ sets: [{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }] })

    render(<WorkoutPage />)

    // 맨몸 세트는 무게 없이 횟수만 보인다.
    expect(await screen.findByText('60kg×10, ×12')).toBeInTheDocument()
  })

  it('유산소는 시간과 강도를 보여준다', async () => {
    await put({
      kind: 'CARDIO', name: '러닝', bodyPart: null, sets: null,
      durationMin: 30, intensity: 'MID',
    })

    render(<WorkoutPage />)

    expect(await screen.findByText('30분 · 보통')).toBeInTheDocument()
  })

  it('기록이 없으면 안내를 보여준다', async () => {
    render(<WorkoutPage />)
    expect(await screen.findByText('기록이 없습니다.')).toBeInTheDocument()
  })

  /**
   * 폼 → repository → 아웃박스 페이로드까지 세트가 도달하는지 한 번에 본다.
   * 배선 중 하나가 빠지면 단위 테스트는 전부 통과하면서 기능만 조용히 깨진다.
   */
  it('입력한 세트가 아웃박스 페이로드까지 도달한다', async () => {
    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.type(await screen.findByLabelText('종목'), '데드리프트')
    await user.type(screen.getByLabelText('1세트 무게(kg)'), '100')
    await user.type(screen.getByLabelText('1세트 횟수'), '5')
    await user.click(screen.getByRole('button', { name: '세트 추가' }))
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    await waitFor(async () => {
      expect(await db.workouts.count()).toBe(1)
    })
    const [queued] = await takeBatch(1)
    expect(queued?.table).toBe('workouts')
    // [+ 세트]가 직전 값을 복사하므로 두 세트가 같은 값이어야 한다.
    expect((queued!.payload as { sets: unknown }).sets).toEqual([
      { reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 },
    ])
    expect(syncSoon).toHaveBeenCalled()
  })

  it('삭제하면 목록에서 빠지고 큐에 DELETE가 쌓인다', async () => {
    await put({ name: '벤치프레스', serverId: 7 })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.click(await screen.findByRole('button', { name: '벤치프레스 삭제' }))

    await waitFor(() => {
      expect(screen.queryByText('벤치프레스')).not.toBeInTheDocument()
    })
    const [queued] = await takeBatch(1)
    expect(queued?.op).toBe('DELETE')
  })

  it('수정하면 같은 레코드가 바뀐다', async () => {
    await put({ name: '벤치프레스' })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.click(await screen.findByRole('button', { name: '벤치프레스 수정' }))
    const nameInput = screen.getByLabelText('종목')
    await user.clear(nameInput)
    await user.type(nameInput, '인클라인 벤치프레스')
    await user.click(screen.getByRole('button', { name: '수정하기' }))

    await waitFor(async () => {
      expect(await db.workouts.count()).toBe(1)
    })
    expect(await screen.findByText('인클라인 벤치프레스')).toBeInTheDocument()
  })

  it('날짜를 바꾸면 그 날의 기록을 보여준다', async () => {
    await put({ occurredOn: '2026-08-01', name: '지난운동' })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.clear(screen.getByLabelText('날짜'))
    await user.type(screen.getByLabelText('날짜'), '2026-08-01')

    expect(await screen.findByText('지난운동')).toBeInTheDocument()
  })

  // 폼은 제출 시점의 occurredOn을 쓴다. 수정 중 날짜를 바꾸면 사용자가 건드린 적
  // 없는 그 기록의 날짜가 조용히 바뀐다.
  it('수정 중 날짜를 바꾸면 수정이 취소되어 기록의 날짜가 옮겨가지 않는다', async () => {
    await put({ occurredOn: TODAY, name: '벤치프레스' })

    const user = userEvent.setup()
    render(<WorkoutPage />)

    await user.click(await screen.findByRole('button', { name: '벤치프레스 수정' }))
    await user.clear(screen.getByLabelText('날짜'))
    await user.type(screen.getByLabelText('날짜'), '2026-08-01')

    // 수정 폼이 닫혀 새 기록 모드로 돌아간다.
    expect(screen.getByRole('button', { name: '기록하기' })).toBeInTheDocument()

    const rows = await db.workouts.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.occurredOn).toBe(TODAY)
  })
})
