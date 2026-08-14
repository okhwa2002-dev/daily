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
