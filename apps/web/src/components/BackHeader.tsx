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
