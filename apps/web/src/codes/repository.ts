import type { CodesResponse } from '@daily/shared'
import { db, type LocalCode } from '../db/index.ts'

/**
 * 공통코드 캐시에 닿는 통로.
 *
 * `pages/<기능>/`이 아니라 `src/` 아래 공용 자리에 있는 이유가 둘이다.
 * 코드 갱신을 거는 주체가 앱 셸(`App.tsx`)이라 기능 폴더에 두면 셸이 기능
 * 폴더를 임포트하게 되고, 애초에 이 테이블의 목적이 여러 업무가 함께 쓰는
 * 것이다.
 */

/** 그룹 하나의 코드를 `sortOrder` 순으로 돌려준다. */
export async function listCodes(groupCode: string): Promise<LocalCode[]> {
  const rows = await db.codes.where('groupCode').equals(groupCode).toArray()
  return rows.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 응답으로 캐시를 통째로 교체한다.
 *
 * 그룹별로 지우고 다시 넣는다. 덮어쓰기만 하면 **서버에서 지워진 코드가 캐시에
 * 영원히 남아** 선택 목록에 계속 뜬다.
 */
export async function replaceCodes(response: CodesResponse): Promise<void> {
  const rows: LocalCode[] = response.groups.flatMap((group) =>
    group.codes.map((c) => ({
      groupCode: group.groupCode,
      code: c.code,
      name: c.name,
      sortOrder: c.sortOrder,
    })),
  )

  await db.transaction('rw', db.codes, async () => {
    for (const group of response.groups) {
      await db.codes.where('groupCode').equals(group.groupCode).delete()
    }
    await db.codes.bulkPut(rows)
  })
}
