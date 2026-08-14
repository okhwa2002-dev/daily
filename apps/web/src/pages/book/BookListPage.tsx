import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { CODE_GROUP, type BookStatus } from '@daily/shared'
import BackHeader from '../../components/BackHeader.tsx'
import SyncStatus from '../../components/SyncStatus.tsx'
import { codeLabel } from '../../codes/label.ts'
import { listCodes } from '../../codes/repository.ts'
import { useSession } from '../../store/session.ts'
import { useSync } from '../../store/sync.ts'
import BookForm, { STATUS_LABEL } from './BookForm.tsx'
import { countNotesByBook, listBooks, saveBook, type BookInput } from './repository.ts'

type Filter = BookStatus | 'ALL'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'READING', label: '읽는 중' },
  { value: 'DONE', label: '완독' },
  { value: 'WISHLIST', label: '읽고 싶음' },
]

export default function BookListPage() {
  const user = useSession((s) => s.user)
  const syncSoon = useSync((s) => s.syncSoon)
  const initialSyncDone = useSync((s) => s.initialSyncDone)

  const userId = user?.id ?? 0
  const [filter, setFilter] = useState<Filter>('ALL')
  const [adding, setAdding] = useState(false)

  // 화면은 로컬 Dexie만 읽는다. useLiveQuery가 로컬 변경과 pull 결과를
  // 모두 자동으로 반영하므로 저장 후 목록을 다시 불러오는 코드가 필요 없다.
  const books = useLiveQuery(() => listBooks(userId, filter), [userId, filter], [])
  const noteCounts = useLiveQuery(() => countNotesByBook(userId), [userId], new Map())
  const genres = useLiveQuery(() => listCodes(CODE_GROUP.BOOK_GENRE), [], [])

  async function handleSubmit(input: BookInput) {
    await saveBook(userId, input)
    setAdding(false)
    // 큐에 넣은 직후 바로 보낸다. 온라인이면 사용자가 기다리지 않는다.
    syncSoon(userId)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <BackHeader title="독서" />

      <SyncStatus />

      {!initialSyncDone && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          기록을 불러오는 중입니다…
        </p>
      )}

      {/* 폼이 열려 있는 동안은 감춘다. 상태 필터 라벨과 폼의 상태 선택 라벨이
          같은 문구('읽는 중' 등)를 쓰므로, 둘 다 보이면 스크린리더 사용자가
          어느 버튼인지 구분할 수 없다. */}
      {!adding && (
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={`flex-1 rounded-lg px-2 py-2 text-sm ${
                filter === f.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {adding ? (
        <BookForm genres={genres} onSubmit={handleSubmit} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-white"
        >
          + 책
        </button>
      )}

      <section className="flex flex-col gap-2">
        {books.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">등록한 책이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {books.map((b) => (
              <li key={b.clientUuid}>
                <Link
                  to={`/books/${b.clientUuid}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900">{b.title}</p>
                    {b.author && <p className="truncate text-xs text-gray-500">{b.author}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {STATUS_LABEL[b.status]}
                    </span>
                    {codeLabel(genres, b.genre) && (
                      <span className="text-xs text-gray-500">
                        {codeLabel(genres, b.genre)}
                      </span>
                    )}
                    {(noteCounts.get(b.clientUuid) ?? 0) > 0 && (
                      <span className="text-xs text-gray-400">
                        감상평 {noteCounts.get(b.clientUuid)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
