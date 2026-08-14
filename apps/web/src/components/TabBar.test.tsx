import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import TabBar from './TabBar.tsx'

const draw = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><TabBar /></MemoryRouter>,
)

describe('TabBar', () => {
  it('탭은 홈과 마이 둘뿐이다', () => {
    draw('/')

    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['홈', '마이'])
  })

  it('지출·독서·운동은 탭이 아니다', () => {
    draw('/')

    expect(screen.queryByText('지출')).not.toBeInTheDocument()
    expect(screen.queryByText('독서')).not.toBeInTheDocument()
    expect(screen.queryByText('운동')).not.toBeInTheDocument()
  })

  // NavLink의 end가 빠지면 '/'가 모든 경로에서 활성으로 잡힌다.
  it('마이에서는 홈이 활성이 아니다', () => {
    draw('/my')

    expect(screen.getByRole('link', { name: '마이' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
  })
})
