import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import RegisterPage from './RegisterPage.tsx'
import { useSession } from '../store/session.ts'

function setup() {
  const register = vi.fn().mockResolvedValue(undefined)
  useSession.setState({ register })
  render(<MemoryRouter><RegisterPage /></MemoryRouter>)
  return register
}

describe('RegisterPage', () => {
  it('아이디·이메일·비밀번호를 함께 보낸다', async () => {
    const register = setup()

    await userEvent.type(screen.getByLabelText('아이디'), 'testuser')
    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '충분히 긴 비밀번호')
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }))

    expect(register).toHaveBeenCalledWith('testuser', 'user@example.com', '충분히 긴 비밀번호')
  })

  it('이메일이 왜 필요한지 화면에서 알려준다', () => {
    setup()
    // 로그인에 쓰지 않는 값을 이유 없이 요구하면 사용자는 가입을 그만둔다.
    expect(screen.getByText(/계정을 되찾는 데/)).toBeInTheDocument()
  })

  it('설명 문구가 필드 이름을 오염시키지 않는다', () => {
    setup()
    // 설명이 label 안에 있으면 접근성 이름이 "아이디영문·숫자·밑줄…"이 되어
    // 스크린리더가 필드 이름을 그렇게 읽는다.
    expect(screen.getByLabelText('아이디')).toHaveAccessibleDescription(/4~20자/)
    expect(screen.getByLabelText('이메일')).toHaveAccessibleDescription(/계정을 되찾는 데/)
  })

  it('아이디 규칙을 화면에서 알려준다', () => {
    setup()
    expect(screen.getByText(/영문·숫자·밑줄 4~20자/)).toBeInTheDocument()
  })

  it('아이디 입력에 자동 대문자·자동 수정이 걸리지 않는다', () => {
    setup()
    const input = screen.getByLabelText('아이디')
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('autocorrect', 'off')
  })

  it('가입 실패 시 에러 메시지를 보여준다', async () => {
    const register = vi.fn().mockRejectedValue(new Error('이미 사용 중인 아이디입니다.'))
    useSession.setState({ register })
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText('아이디'), 'testuser')
    await userEvent.type(screen.getByLabelText('이메일'), 'user@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), '충분히 긴 비밀번호')
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 사용 중인 아이디입니다.')
    expect(register).toHaveBeenCalled()
  })
})
