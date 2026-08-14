import { NavLink } from 'react-router'

/**
 * 하단 탭 내비게이션.
 *
 * 탭은 홈과 마이 둘이다. 기능이 늘어도 탭은 늘리지 않는다 — 일기·식사가
 * 붙으면 탭이 아니라 마이 화면의 카드가 한 장씩 는다.
 *
 * 화면 스택 안쪽(지출·독서·운동·책 상세)에서는 이 컴포넌트를 렌더링하지
 * 않는다. 다른 탭으로 바로 나가면 돌아올 자리를 잃고, 마이 탭 안에서
 * 마이 탭을 누르는 상태가 생긴다.
 */
const TABS = [
  { to: '/', label: '홈' },
  { to: '/my', label: '마이' },
] as const

export default function TabBar() {
  return (
    <nav
      aria-label="주요 화면"
      className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md border-t border-gray-200 bg-white"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `flex-1 py-3 text-center text-sm ${
              isActive ? 'font-semibold text-gray-900' : 'text-gray-500'
            }`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
