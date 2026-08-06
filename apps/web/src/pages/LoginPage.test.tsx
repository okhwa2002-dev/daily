import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import LoginPage from './LoginPage.tsx'
import { useSession } from '../store/session.ts'

describe('LoginPage', () => {
  it('이메일과 비밀번호를 입력해 로그인을 호출한다', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '충분히 긴 비밀번호')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(login).toHaveBeenCalledWith('user@example.com', '충분히 긴 비밀번호')
  })

  it('로그인 실패 시 에러 메시지를 보여준다', async () => {
    const login = vi.fn().mockRejectedValue(new Error('이메일 또는 비밀번호가 올바르지 않습니다.'))
    useSession.setState({ login })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '틀린 비밀번호입니다')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않습니다.')
  })
})
