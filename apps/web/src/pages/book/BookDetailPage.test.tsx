import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { db } from '../../db/index.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookDetailPage from './BookDetailPage.tsx'
import { saveBook, saveNote } from './repository.ts'

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

const renderAt = (uuid: string) =>
  render(
    <MemoryRouter initialEntries={[`/books/${uuid}`]}>
      <Routes>
        <Route path="/books" element={<p>목록</p>} />
        <Route path="/books/:clientUuid" element={<BookDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )

const makeBook = () => saveBook(USER.id, {
  title: '사피엔스', author: '유발 하라리', summary: '인류의 역사',
  status: 'READING', startedOn: '2026-08-01', finishedOn: null,
})

const makeNote = (bookUuid: string, occurredOn: string, content: string) =>
  saveNote(USER.id, { occurredOn, bookClientUuid: bookUuid, content })

describe('책 상세', () => {
  it('책 정보를 보여준다', async () => {
    const uuid = await makeBook()
    renderAt(uuid)

    expect(await screen.findByText('사피엔스')).toBeInTheDocument()
    expect(screen.getByText('유발 하라리')).toBeInTheDocument()
    expect(screen.getByText('읽는 중')).toBeInTheDocument()
  })

  it('없는 책이면 목록으로 돌려보낸다', async () => {
    renderAt('aaaaaaaa-0000-4000-8000-000000000009')
    expect(await screen.findByText('목록')).toBeInTheDocument()
  })

  it('감상평을 최근 날짜부터 보여준다', async () => {
    const uuid = await makeBook()
    await makeNote(uuid, '2026-08-09', '앞 감상')
    await makeNote(uuid, '2026-08-11', '뒤 감상')

    renderAt(uuid)

    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('뒤 감상')
    expect(items[1]).toHaveTextContent('앞 감상')
  })

  it('감상평을 쓰면 목록에 나타난다', async () => {
    const uuid = await makeBook()
    renderAt(uuid)
    await screen.findByText('사피엔스')

    await userEvent.type(screen.getByLabelText('감상평'), '3부가 인상 깊다')
    await userEvent.click(screen.getByRole('button', { name: '남기기' }))

    expect(await screen.findByText('3부가 인상 깊다')).toBeInTheDocument()
  })

  it('감상평이 있는 책을 지울 때 몇 건인지 알린다', async () => {
    const uuid = await makeBook()
    await makeNote(uuid, '2026-08-11', '좋다')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderAt(uuid)
    await screen.findByText('사피엔스')
    await userEvent.click(screen.getByRole('button', { name: '책 삭제' }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('감상평 1건'))
    // 취소했으므로 그대로 남는다.
    expect((await db.books.get(uuid))?.deletedAt).toBeNull()
    confirmSpy.mockRestore()
  })

  it('책을 지워도 감상평은 남는다', async () => {
    const uuid = await makeBook()
    const noteUuid = await makeNote(uuid, '2026-08-11', '좋다')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderAt(uuid)
    await screen.findByText('사피엔스')
    await userEvent.click(screen.getByRole('button', { name: '책 삭제' }))

    await waitFor(async () => {
      expect((await db.books.get(uuid))?.deletedAt).not.toBeNull()
    })
    expect((await db.bookNotes.get(noteUuid))?.deletedAt).toBeNull()
    confirmSpy.mockRestore()
  })
})
