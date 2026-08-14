import { describe, expect, it } from 'vitest'
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
