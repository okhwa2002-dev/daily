import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import BackHeader from './BackHeader.tsx'

const draw = (entries: string[]) => render(
  <MemoryRouter initialEntries={entries}>
    <Routes>
      <Route path="/expenses" element={<BackHeader title="지출" />} />
      <Route path="/my" element={<p>마이 화면</p>} />
      <Route path="/" element={<p>홈 화면</p>} />
    </Routes>
  </MemoryRouter>,
)

describe('BackHeader', () => {
  it('제목을 제목 요소로 보여준다', () => {
    draw(['/expenses'])

    expect(screen.getByRole('heading', { name: '지출' })).toBeInTheDocument()
  })

  // 홈의 '자세히'를 눌러 들어온 사용자는 홈으로 돌아가야 한다.
  it('히스토리가 있으면 직전 화면으로 돌아간다', async () => {
    draw(['/', '/expenses'])

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))

    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  // PWA를 새로 열거나 북마크로 직접 들어오면 뒤로 갈 곳이 없다.
  // navigate(-1)이면 앱 밖으로 나간다.
  it('히스토리가 없으면 마이로 올려보낸다', async () => {
    draw(['/expenses'])

    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))

    expect(await screen.findByText('마이 화면')).toBeInTheDocument()
  })
})
