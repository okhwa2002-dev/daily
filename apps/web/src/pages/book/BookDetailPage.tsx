import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookForm, { STATUS_LABEL } from './BookForm.tsx'
import BookNoteForm from './BookNoteForm.tsx'
import {
  deleteBook, deleteNote, getBook, listNotesByBook, saveBook, saveNote,
  type BookInput, type BookNoteInput,
} from './repository.ts'

export default function BookDetailPage() {
  const { clientUuid = '' } = useParams()
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)

  const userId = user?.id ?? 0
  const [editing, setEditing] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  // undefined는 "아직 읽는 중", null은 "없는 책"이다. 둘을 구분하지 않으면
  // 로딩 한 틱 동안 목록으로 튕긴다.
  const book = useLiveQuery(
    async () => (await getBook(userId, clientUuid)) ?? null,
    [userId, clientUuid],
  )
  const notes = useLiveQuery(
    () => listNotesByBook(userId, clientUuid), [userId, clientUuid], [],
  )

  if (book === undefined) {
    return <main className="grid min-h-dvh place-items-center">불러오는 중…</main>
  }
  // 다른 기기에서 지웠거나 아직 pull되지 않았다.
  if (book === null) return <Navigate to="/books" replace />

  // 위에서 narrowing한 book === null 여부는 아래 중첩 함수 안까지 이어지지
  // 않는다(TS는 클로저 안의 재평가 가능성을 보수적으로 취급한다). 필요한
  // 값만 지금 이 시점에 상수로 뽑아 쓴다.
  const bookTitle = book.title

  async function handleEdit(input: BookInput) {
    await saveBook(userId, input, clientUuid)
    setEditing(false)
    syncSoon(userId)
  }

  async function handleNote(input: BookNoteInput) {
    await saveNote(userId, input)
    syncSoon(userId)
  }

  async function handleDeleteNote(noteUuid: string) {
    await deleteNote(userId, noteUuid)
    syncSoon(userId)
  }

  async function handleDeleteBook() {
    // 감상평은 함께 지우지 않는다. 몇 건이 보이지 않게 되는지 먼저 알린다.
    const warning = notes.length > 0
      ? `감상평 ${notes.length}건이 함께 보이지 않게 됩니다.\n`
      : ''
    if (!window.confirm(`${warning}"${bookTitle}"을(를) 삭제할까요?`)) return

    await deleteBook(userId, clientUuid)
    syncSoon(userId)
    void navigate('/books', { replace: true })
  }

  const period = [book.startedOn, book.finishedOn].some(Boolean)
    ? `${book.startedOn ?? '?'} ~ ${book.finishedOn ?? '읽는 중'}`
    : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void navigate('/books')}
          className="text-sm underline"
        >
          ← 목록
        </button>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditing(true)} className="text-sm underline">
            수정
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteBook()}
            className="text-sm text-gray-400 underline"
          >
            책 삭제
          </button>
        </div>
      </header>

      {editing ? (
        <BookForm initial={book} onSubmit={handleEdit} onCancel={() => setEditing(false)} />
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4">
          <h1 className="text-lg font-semibold">{book.title}</h1>
          {book.author && <p className="text-sm text-gray-500">{book.author}</p>}
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {STATUS_LABEL[book.status]}
            </span>
            {period && <span className="text-xs text-gray-400">{period}</span>}
          </div>
          {book.summary && (
            <button
              type="button"
              onClick={() => setShowSummary((v) => !v)}
              className="text-left text-sm text-gray-600"
            >
              {showSummary ? book.summary : '책 소개 보기'}
            </button>
          )}
        </section>
      )}

      <BookNoteForm bookClientUuid={clientUuid} onSubmit={handleNote} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-600">감상평 {notes.length}</h2>
        {notes.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">아직 남긴 감상평이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li
                key={n.clientUuid}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">{n.occurredOn}</p>
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{n.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteNote(n.clientUuid)}
                  aria-label="감상평 삭제"
                  className="shrink-0 text-xs text-gray-400 underline"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
