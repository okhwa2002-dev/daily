import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import LoginPage from './LoginPage.tsx'
import { useSession } from '../store/session.ts'

describe('LoginPage', () => {
  it('아이디와 비밀번호를 입력해 로그인을 호출한다', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('아이디'), 'testuser')
    await userEvent.type(screen.getByLabelText('비밀번호'), '충분히 긴 비밀번호')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(login).toHaveBeenCalledWith('testuser', '충분히 긴 비밀번호')
  })

  it('아이디 입력에 자동 대문자·자동 수정이 걸리지 않는다', async () => {
    useSession.setState({ login: vi.fn() })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    // 모바일 키보드가 첫 글자를 대문자로 바꾸면 사용자가 입력한 적 없는
    // 아이디로 로그인을 시도하게 된다.
    const input = screen.getByLabelText('아이디')
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('autocorrect', 'off')
  })

  it('로그인 실패 시 에러 메시지를 보여준다', async () => {
    const login = vi.fn().mockRejectedValue(new Error('아이디 또는 비밀번호가 올바르지 않습니다.'))
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('아이디'), 'testuser')
    await userEvent.type(screen.getByLabelText('비밀번호'), '틀린 비밀번호입니다')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('아이디 또는 비밀번호가 올바르지 않습니다.')
  })
})
