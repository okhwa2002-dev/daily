import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodesResponse } from '@daily/shared'
import { db } from '../db/index.ts'
import { setAccessToken } from '../lib/apiClient.ts'
import { codeLabel } from './label.ts'
import { refreshCodes } from './refresh.ts'
import { listCodes, replaceCodes } from './repository.ts'

const fetchMock = vi.fn()

const response = (codes: { code: string; name: string; sortOrder: number }[]): CodesResponse => ({
  groups: [{ groupCode: 'BOOK_GENRE', name: '독서 장르', codes }],
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setAccessToken('token')
  await db.codes.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('코드 캐시', () => {
  it('응답을 저장하고 그룹으로 조회한다', async () => {
    await replaceCodes(response([
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
      { code: 'ESSAY', name: '에세이', sortOrder: 2 },
    ]))

    const list = await listCodes('BOOK_GENRE')
    expect(list.map((c) => c.code)).toEqual(['NOVEL', 'ESSAY'])
    expect(list[0]?.name).toBe('소설')
  })

  it('sortOrder 순으로 돌려준다', async () => {
    await replaceCodes(response([
      { code: 'ESSAY', name: '에세이', sortOrder: 2 },
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
    ]))

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL', 'ESSAY'])
  })

  // 서버에서 지워진 코드가 캐시에 남으면 선택 목록에 계속 뜬다.
  it('갱신 시 사라진 코드는 캐시에서도 빠진다', async () => {
    await replaceCodes(response([
      { code: 'NOVEL', name: '소설', sortOrder: 1 },
      { code: 'GONE', name: '사라질것', sortOrder: 2 },
    ]))
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  it('없는 그룹은 빈 배열이다', async () => {
    expect(await listCodes('NO_SUCH_GROUP')).toEqual([])
  })
})

describe('refreshCodes', () => {
  it('응답을 캐시에 반영한다', async () => {
    fetchMock.mockResolvedValueOnce(
      json(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }])),
    )

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  // 네트워크가 없다고 장르 목록이 사라지면 안 된다.
  it('요청이 실패해도 기존 캐시를 지우지 않는다', async () => {
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })

  it('서버가 오류를 주어도 기존 캐시를 지키다', async () => {
    await replaceCodes(response([{ code: 'NOVEL', name: '소설', sortOrder: 1 }]))
    fetchMock.mockResolvedValueOnce(json({ error: { message: '서버 오류' } }, 500))

    await refreshCodes()

    expect((await listCodes('BOOK_GENRE')).map((c) => c.code)).toEqual(['NOVEL'])
  })
})

describe('codeLabel', () => {
  const list = [
    { groupCode: 'BOOK_GENRE', code: 'NOVEL', name: '소설', sortOrder: 1 },
  ]

  it('코드값을 라벨로 바꾼다', () => {
    expect(codeLabel(list, 'NOVEL')).toBe('소설')
  })

  it('미지정은 null이다', () => {
    expect(codeLabel(list, null)).toBeNull()
  })

  // 관리자가 지운 장르를 쓰던 기록이 빈칸이 되면 사용자는 자기 기록이 손상된
  // 것으로 읽는다. 라벨을 모르면 코드값이라도 보여준다.
  it('캐시에 없는 코드값은 코드값 그대로 돌려준다', () => {
    expect(codeLabel(list, 'GONE')).toBe('GONE')
  })
})
