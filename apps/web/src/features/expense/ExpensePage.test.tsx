import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import ExpensePage from './ExpensePage.tsx'
import { DEFAULT_CATEGORY_NAMES } from './repository.ts'

const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const TODAY = kstDate(new Date())

const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.expenses.clear()
  await db.expenseCategories.clear()
  await db.outbox.clear()
  await db.syncFailures.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

/**
 * 기본 카테고리 생성이 **끝까지** 끝나기를 기다린다.
 *
 * 첫 항목만 기다리면 나머지 생성이 다음 테스트로 새고, 그 테스트의
 * ensureDefaultCategories는 count > 0을 보고 생성을 통째로 건너뛴다.
 */
async function categoriesReady() {
  await waitFor(async () => {
    expect(await db.expenseCategories.count()).toBe(DEFAULT_CATEGORY_NAMES.length)
  })
  await screen.findByRole('option', { name: '식비' })
}

describe('지출 화면', () => {
  it('기본 카테고리를 만들어 선택지로 보여준다', async () => {
    render(<ExpensePage />)

    await waitFor(async () => {
      expect(await db.expenseCategories.count()).toBe(5)
    })
    // 다섯 건이 한 트랜잭션에서 커밋되므로 liveQuery 반영을 기다린다.
    expect(await screen.findByRole('option', { name: '식비' })).toBeInTheDocument()
  })

  it('StrictMode에서 이중 마운트해도 카테고리가 한 벌만 생긴다', async () => {
    render(<StrictMode><ExpensePage /></StrictMode>)

    await waitFor(async () => {
      expect(await db.expenseCategories.count()).toBe(DEFAULT_CATEGORY_NAMES.length)
    })
    // 이름이 두 번씩 뜨면 사용자는 어느 쪽을 골라야 할지 알 수 없다.
    expect(await screen.findAllByRole('option', { name: '식비' })).toHaveLength(1)
  })

  it('초기 동기화 전에는 기본 카테고리를 만들지 않는다', async () => {
    // 새 기기에서 로컬은 비어 있다. pull 전에 만들면 서버에 이미 있는 같은
    // 이름이 다른 UUID로 내려와 목록이 두 벌이 된다.
    useSync.setState({ initialSyncDone: false })
    render(<ExpensePage />)

    await screen.findByLabelText('금액')
    expect(await db.expenseCategories.count()).toBe(0)

    useSync.setState({ initialSyncDone: true })
    await categoriesReady()
  })

  it('입력한 지출이 목록과 합계에 반영된다', async () => {
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    await user.type(screen.getByLabelText('금액'), '12000')
    await user.type(screen.getByLabelText('메모'), '점심 김밥')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(await screen.findByText('점심 김밥')).toBeInTheDocument()
    expect(await screen.findByText(/합계 -12,000원/)).toBeInTheDocument()
    // 큐에 넣은 직후 바로 보내야 사용자가 기다리지 않는다.
    expect(syncSoon).toHaveBeenCalledWith(USER.id)
  })

  it('수입은 합계를 더한다', async () => {
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    await user.click(screen.getByRole('button', { name: '수입' }))
    await user.type(screen.getByLabelText('금액'), '50000')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(await screen.findByText(/합계 50,000원/)).toBeInTheDocument()
  })

  it('금액 형식이 틀리면 저장하지 않고 알린다', async () => {
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    await user.type(screen.getByLabelText('금액'), '1000.999')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('소수점 두 자리')
    expect(await db.expenses.count()).toBe(0)
  })

  it('삭제하면 목록에서 사라지되 툼스톤은 남는다', async () => {
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    await user.type(screen.getByLabelText('금액'), '1000')
    await user.click(screen.getByRole('button', { name: '기록하기' }))
    await screen.findByRole('button', { name: '삭제' })

    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(screen.getByText('기록이 없습니다.')).toBeInTheDocument()
    })
    // 삭제가 다른 기기로 전파되려면 레코드가 남아 있어야 한다.
    expect(await db.expenses.count()).toBe(1)
  })

  it('미동기화 건수를 보여준다', async () => {
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    await user.type(screen.getByLabelText('금액'), '1000')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    // 이 표시가 없으면 동기화가 조용히 멈춰도 아무도 알아채지 못한다.
    expect(await screen.findByText(/미동기화 \d+건/)).toBeInTheDocument()
  })

  it('초기 동기화가 끝나기 전에는 불러오는 중임을 알린다', async () => {
    useSync.setState({ initialSyncDone: false })
    render(<ExpensePage />)
    expect(screen.getByText('기록을 불러오는 중입니다…')).toBeInTheDocument()
  })

  it('다른 날짜를 고르면 그 날의 기록만 보여준다', async () => {
    await db.expenses.put({
      clientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      userId: USER.id, serverId: null,
      occurredOn: '2020-01-01', kind: 'EXPENSE', amount: '7777',
      categoryClientUuid: null, memo: '지난 기록',
      updatedAt: '2020-01-01 00:00:00.000', deletedAt: null,
    })
    const user = userEvent.setup()
    render(<ExpensePage />)
    await categoriesReady()

    expect(screen.queryByText('지난 기록')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('날짜'))
    await user.type(screen.getByLabelText('날짜'), '2020-01-01')

    expect(await screen.findByText('지난 기록')).toBeInTheDocument()
  })

  it('오늘 날짜로 시작한다', async () => {
    render(<ExpensePage />)
    expect(screen.getByLabelText('날짜')).toHaveValue(TODAY)
    await categoriesReady()
  })
})
