import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LocalWorkout } from '../../db/index.ts'
import WorkoutForm from './WorkoutForm.tsx'

const TODAY = '2026-08-13'

function setup(over: Partial<Parameters<typeof WorkoutForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <WorkoutForm
      occurredOn={TODAY}
      recentNames={['벤치프레스', '스쿼트']}
      onSubmit={onSubmit}
      {...over}
    />,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('운동 폼', () => {
  it('근력을 세트와 함께 저장한다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '벤치프레스')
    await user.selectOptions(screen.getByLabelText('부위'), 'CHEST')
    await user.type(screen.getByLabelText('1세트 무게(kg)'), '60')
    await user.type(screen.getByLabelText('1세트 횟수'), '10')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      occurredOn: TODAY, kind: 'STRENGTH', name: '벤치프레스',
      bodyPart: 'CHEST', sets: [{ reps: 10, weightKg: 60 }],
      durationMin: null, intensity: null, memo: null,
    })
  })

  it('유산소를 지속 시간과 함께 저장한다', async () => {
    const { onSubmit, user } = setup()

    await user.click(screen.getByRole('button', { name: '유산소' }))
    await user.type(screen.getByLabelText('종목'), '러닝')
    await user.type(screen.getByLabelText('시간(분)'), '30')
    await user.selectOptions(screen.getByLabelText('강도'), 'MID')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith({
      occurredOn: TODAY, kind: 'CARDIO', name: '러닝', bodyPart: null,
      sets: null, durationMin: 30, intensity: 'MID', memo: null,
    })
  })

  /**
   * 근력으로 세트를 채우다 유산소로 바꾸고 저장하면 sets와 durationMin이
   * 함께 실려 zod에서 거부된다. 그 거부는 서버까지 갔다가 REJECTED로
   * 돌아오므로 사용자는 저장이 안 된 이유를 알 수 없다.
   */
  it('kind를 바꾸면 반대쪽 필드가 비워진다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('1세트 무게(kg)'), '60')
    await user.type(screen.getByLabelText('1세트 횟수'), '10')
    await user.click(screen.getByRole('button', { name: '유산소' }))
    await user.type(screen.getByLabelText('종목'), '러닝')
    await user.type(screen.getByLabelText('시간(분)'), '30')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sets: null }))

    // 근력으로 돌아가면 세트도 비어 있어야 한다.
    await user.click(screen.getByRole('button', { name: '근력' }))
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('')
  })

  it('맨몸 운동은 무게 없이 저장된다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '풀업')
    await user.type(screen.getByLabelText('1세트 횟수'), '12')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      sets: [{ reps: 12, weightKg: null }],
    }))
  })

  it('세트가 하나도 채워지지 않으면 저장하지 않고 알린다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '벤치프레스')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('세트')
  })

  // toSets는 절반만 채운 행을 버리지 않고 reps: 0으로 내보낸다. 말없이 지우면
  // 사용자가 뭘 잃었는지 모른 채 저장이 끝나기 때문이다. 폼이 여기서 거절한다.
  it('무게만 채우고 횟수를 비우면 저장하지 않고 알린다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '벤치프레스')
    await user.type(screen.getByLabelText('1세트 무게(kg)'), '60')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('횟수')
  })

  it('최근 종목을 제안한다', () => {
    setup()
    // datalist는 UA 스타일시트에서 display:none이라 testing-library가
    // 기본적으로 접근성 트리에서 제외한다. hidden: true로 그 필터를 끈다.
    expect(screen.getByRole('option', { name: '벤치프레스', hidden: true })).toBeInTheDocument()
  })

  it('제안에 없는 종목도 그대로 입력된다', async () => {
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('종목'), '케틀벨 스윙')
    await user.type(screen.getByLabelText('1세트 횟수'), '15')
    await user.click(screen.getByRole('button', { name: '기록하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '케틀벨 스윙' }))
  })

  it('수정 모드는 기존 값으로 시작한다', () => {
    const initial: LocalWorkout = {
      clientUuid: 'x', userId: 1, serverId: 1,
      occurredOn: TODAY, kind: 'STRENGTH', name: '스쿼트', bodyPart: 'LEGS',
      sets: [{ reps: 5, weightKg: 100 }], durationMin: null, intensity: 'HIGH',
      memo: '무거움', updatedAt: '2026-08-13 12:00:00.000', deletedAt: null,
    }
    setup({ initial })

    expect(screen.getByLabelText('종목')).toHaveValue('스쿼트')
    expect(screen.getByLabelText('1세트 무게(kg)')).toHaveValue('100')
    expect(screen.getByLabelText('메모')).toHaveValue('무거움')
  })
})
