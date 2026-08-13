import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetRows, { emptySetRow, toSetRows, toSets, type SetRow } from './SetRows.tsx'

function Harness({ initial }: { initial: SetRow[] }) {
  const [rows, setRows] = useState(initial)
  return (
    <>
      <SetRows rows={rows} onChange={setRows} />
      <output data-testid="json">{JSON.stringify(toSets(rows))}</output>
    </>
  )
}

const json = () => JSON.parse(screen.getByTestId('json').textContent ?? 'null')

describe('toSets', () => {
  // [+ 세트]로 복사해 놓고 안 채운 행이 그대로 실려 나가면
  // reps가 positive()에서 걸려 저장이 통째로 거부된다.
  it('무게·횟수가 모두 빈 행은 버린다', () => {
    expect(toSets([{ weightKg: '60', reps: '10' }, emptySetRow()]))
      .toEqual([{ reps: 10, weightKg: 60 }])
  })

  // 0kg과 '무게 없음'은 다르다. 0으로 바꾸면 스키마가 통과시켜 버린다.
  it('무게만 비면 맨몸 운동이다 — null이지 0이 아니다', () => {
    expect(toSets([{ weightKg: '', reps: '12' }]))
      .toEqual([{ reps: 12, weightKg: null }])
  })

  it('빈 배열이 되면 빈 배열을 돌려준다', () => {
    expect(toSets([emptySetRow()])).toEqual([])
  })

  it('소수점 무게를 그대로 보존한다', () => {
    expect(toSets([{ weightKg: '62.5', reps: '5' }]))
      .toEqual([{ reps: 5, weightKg: 62.5 }])
  })

  // Number('.')는 NaN이고, NaN은 JSON.stringify에서 null이 된다 —
  // 사용자가 친 무게가 오류 없이 '맨몸'으로 둔갑한다.
  it('무게가 소수점뿐이면 맨몸으로 떨어뜨리지 NaN을 내보내지 않는다', () => {
    expect(toSets([{ weightKg: '.', reps: '5' }]))
      .toEqual([{ reps: 5, weightKg: null }])
  })
})

describe('toSetRows', () => {
  it('서버 세트를 폼 행으로 되돌린다', () => {
    expect(toSetRows([{ reps: 10, weightKg: 60 }, { reps: 12, weightKg: null }]))
      .toEqual([{ weightKg: '60', reps: '10' }, { weightKg: '', reps: '12' }])
  })

  it('세트가 없으면 빈 행 하나로 시작한다', () => {
    expect(toSetRows(null)).toEqual([emptySetRow()])
  })

  it('빈 배열도 빈 행 하나로 시작한다', () => {
    expect(toSetRows([])).toEqual([emptySetRow()])
  })
})

describe('SetRows 화면', () => {
  it('[+ 세트]가 마지막 행의 무게·횟수를 복사한다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ weightKg: '60', reps: '10' }]} />)

    await user.click(screen.getByRole('button', { name: '세트 추가' }))

    expect(json()).toEqual([
      { reps: 10, weightKg: 60 }, { reps: 10, weightKg: 60 },
    ])
  })

  it('첫 행은 빈 값이다', () => {
    render(<Harness initial={[emptySetRow()]} />)
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('')
    expect(screen.getByLabelText('1세트 횟수')).toHaveValue('')
  })

  it('행을 지울 수 있다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[
      { weightKg: '60', reps: '10' }, { weightKg: '50', reps: '8' },
    ]} />)

    await user.click(screen.getByRole('button', { name: '2세트 삭제' }))

    expect(json()).toEqual([{ reps: 10, weightKg: 60 }])
  })

  // workoutSetsSchema가 .min(1)이다. 마지막 행까지 지우면 저장이 거부된다.
  it('마지막 한 행은 지울 수 없다', () => {
    render(<Harness initial={[{ weightKg: '60', reps: '10' }]} />)
    expect(screen.queryByRole('button', { name: '1세트 삭제' })).not.toBeInTheDocument()
  })

  it('50세트에 도달하면 더 추가할 수 없다', () => {
    render(<Harness initial={Array.from({ length: 50 }, () => ({
      weightKg: '60', reps: '10',
    }))} />)
    expect(screen.getByRole('button', { name: '세트 추가' })).toBeDisabled()
  })

  it('숫자가 아닌 입력은 들어가지 않는다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[emptySetRow()]} />)

    await user.type(screen.getByLabelText('1세트 횟수'), 'a1b2')

    expect(screen.getByLabelText('1세트 횟수')).toHaveValue('12')
  })

  // 2.5kg 원판이 흔하다. 정수만 받으면 62.5kg를 기록할 방법이 없다.
  it('무게에 소수점을 칠 수 있다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[emptySetRow()]} />)

    await user.type(screen.getByLabelText('1세트 무게(kg)'), '62.5')
    await user.type(screen.getByLabelText('1세트 횟수'), '5')

    expect(json()).toEqual([{ reps: 5, weightKg: 62.5 }])
  })

  it('무게 칸에 소수점만 치면 빈 칸으로 되돌린다', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[emptySetRow()]} />)

    await user.type(screen.getByLabelText('1세트 무게(kg)'), '.')

    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('')
  })
})
