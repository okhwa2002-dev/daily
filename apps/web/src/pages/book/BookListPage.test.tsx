import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { kstDate } from '@daily/shared'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookListPage from './BookListPage.tsx'
import { saveBook } from './repository.ts'

// 세션·동기화 스토어 세팅은 ExpensePage.test.tsx와 같은 모양이다.
// useSync를 세팅하지 않으면 syncSoon이 진짜 엔진을 불러 fetch를 때린다.
const USER = { id: 1, loginId: 'auser', email: 'a@example.com' }
const syncSoon = vi.fn()

beforeEach(async () => {
  syncSoon.mockClear()
  await db.books.clear()
  await db.bookNotes.clear()
  await db.outbox.clear()

  useSession.setState({ user: USER, status: 'AUTHENTICATED', logout: async () => {} })
  useSync.setState({
    syncing: false, lastError: null, rejected: 0, initialSyncDone: true,
    syncSoon, stop: () => {},
  })
})

const renderPage = () =>
  render(<MemoryRouter><BookListPage /></MemoryRouter>)

describe('책 목록', () => {
  it('기록이 없으면 안내를 보여준다', async () => {
    renderPage()
    expect(await screen.findByText('등록한 책이 없습니다.')).toBeInTheDocument()
  })

  it('책과 감상평 수를 보여준다', async () => {
    const uuid = await saveBook(USER.id, {
      title: '사피엔스', author: '유발 하라리', summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
    await db.bookNotes.put({
      clientUuid: 'bbbbbbbb-0000-4000-8000-000000000002',
      userId: USER.id, serverId: null, occurredOn: '2026-08-11',
      bookClientUuid: uuid, content: '좋다',
      updatedAt: '2026-08-11 12:00:00.000', deletedAt: null,
    })

    renderPage()

    expect(await screen.findByText('사피엔스')).toBeInTheDocument()
    expect(await screen.findByText('유발 하라리')).toBeInTheDocument()
    expect(await screen.findByText('감상평 1')).toBeInTheDocument()
  })

  it('상태 탭으로 거른다', async () => {
    await saveBook(USER.id, {
      title: '읽는 책', author: null, summary: null,
      status: 'READING', startedOn: null, finishedOn: null,
    })
    await saveBook(USER.id, {
      title: '완독한 책', author: null, summary: null,
      status: 'DONE', startedOn: null, finishedOn: '2026-08-10',
    })

    renderPage()
    await screen.findByText('읽는 책')

    await userEvent.click(screen.getByRole('button', { name: '완독' }))

    await waitFor(() => {
      expect(screen.queryByText('읽는 책')).not.toBeInTheDocument()
    })
    expect(screen.getByText('완독한 책')).toBeInTheDocument()
  })

  it('책을 등록하면 목록에 나타난다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('클린 코드')).toBeInTheDocument()
  })

  it('상태를 읽는 중으로 두면 시작일이 오늘로 채워진다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.click(screen.getByRole('button', { name: '읽는 중' }))

    // 값이 뭐라도 채워졌다는 것만으로는 부족하다 — 오늘 날짜인지까지 확인해야
    // 엉뚱한 값이 들어가도 통과하는 약한 단언이 되지 않는다.
    expect(screen.getByLabelText('시작일')).toHaveValue(kstDate(new Date()))
  })

  // pickStatus의 `startedOn === ''` 가드가 하는 일은 "이미 값이 있으면 안
  // 덮는다"이다. 위 테스트는 빈 값 → 채움 경로만 지나가므로, 이 가드가
  // 통째로 사라져도(예: 리팩터링 실수) 초록으로 남는다. 아래 두 테스트가
  // 그 가드를 직접 지킨다.
  it('시작일을 먼저 채우면 읽는 중을 눌러도 값이 유지된다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.type(screen.getByLabelText('시작일'), '2020-01-01')

    await userEvent.click(screen.getByRole('button', { name: '읽는 중' }))

    expect(screen.getByLabelText('시작일')).toHaveValue('2020-01-01')
  })

  it('완독일을 먼저 채우면 완독을 눌러도 값이 유지된다', async () => {
    renderPage()
    await screen.findByText('등록한 책이 없습니다.')

    await userEvent.click(screen.getByRole('button', { name: '+ 책' }))
    await userEvent.type(screen.getByLabelText('제목'), '클린 코드')
    await userEvent.type(screen.getByLabelText('완독일'), '2020-01-01')

    await userEvent.click(screen.getByRole('button', { name: '완독' }))

    expect(screen.getByLabelText('완독일')).toHaveValue('2020-01-01')
  })
})
