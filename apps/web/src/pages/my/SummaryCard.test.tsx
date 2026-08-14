import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SummaryCard from './SummaryCard.tsx'

const draw = (over: Partial<Parameters<typeof SummaryCard>[0]> = {}) => render(
  <MemoryRouter>
    <SummaryCard
      title="지출"
      summary="-32,000원"
      to="/expenses?date=2026-08-14"
      lines={['-12,000원 · 점심 김밥']}
      empty="오늘 기록이 없습니다"
      {...over}
    />
  </MemoryRouter>,
)

describe('SummaryCard', () => {
  it('제목·요약·미리보기를 보여준다', () => {
    draw()

    expect(screen.getByText('지출')).toBeInTheDocument()
    expect(screen.getByText('-32,000원')).toBeInTheDocument()
    expect(screen.getByText('-12,000원 · 점심 김밥')).toBeInTheDocument()
  })

  // 카드가 곧 등록 화면 입구다. 카드 전체가 눌려야 한다.
  it('카드 전체가 목적지로 가는 링크다', () => {
    draw()

    const link = screen.getByRole('link', { name: /지출/ })
    expect(link).toHaveAttribute('href', '/expenses?date=2026-08-14')
  })

  // key={line}은 값이 겹치면 React가 "duplicated and/or omitted"라고 경고하는
  // 상태다 — 같은 3,000원짜리 지출 두 건처럼 실사용 데이터에서 흔하다. 현재
  // React 버전은 이 케이스에서도 두 줄을 화면에 그대로 남기지만(getAllByText는
  // 그래서 고정된 회귀 신호가 아니다), key 충돌 자체는 console.error로 실제
  // 경고를 낸다 — 이 경고가 없어야 진짜로 고쳐진 것이다.
  it('미리보기 줄이 같은 문자열이어도 둘 다 보여주고, key 충돌 경고를 내지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    draw({ lines: ['-3,000원', '-3,000원'] })

    expect(screen.getAllByText('-3,000원')).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('미리보기가 비면 안내 문구를 대신 보여준다', () => {
    draw({ lines: [] })

    expect(screen.getByText('오늘 기록이 없습니다')).toBeInTheDocument()
  })

  // 독서 카드만 날짜 축이 아니라 '오늘'이 붙으면 틀린 말이 된다.
  it('안내 문구는 카드마다 다르게 넣을 수 있다', () => {
    draw({ lines: [], empty: '읽는 중인 책이 없습니다' })

    expect(screen.getByText('읽는 중인 책이 없습니다')).toBeInTheDocument()
  })
})
