import { NavLink } from 'react-router'

/**
 * 하단 탭 내비게이션.
 *
 * 일기·식사·운동이 붙으면 이 배열에 한 줄씩 더한다. 화면 스택 안쪽
 * (책 상세 등)에서는 이 컴포넌트를 렌더링하지 않는다 — 다른 탭으로 바로
 * 나가면 돌아올 자리를 잃는다.
 */
const TABS = [
  { to: '/', label: '지출' },
  { to: '/books', label: '독서' },
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
