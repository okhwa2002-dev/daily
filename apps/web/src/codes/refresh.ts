import type { CodesResponse } from '@daily/shared'
import { apiFetch } from '../lib/apiClient.ts'
import { replaceCodes } from './repository.ts'

/**
 * 서버에서 공통코드를 받아 캐시를 갱신한다. 인증 직후 한 번 부른다.
 *
 * **실패해도 던지지 않고 기존 캐시를 남긴다.** 네트워크가 없다고 장르 목록이
 * 사라지면, 오프라인에서 책을 등록하려던 사용자가 장르를 고를 수 없게 된다.
 * 오프라인 입력이 이 앱의 존재 이유이므로 그 경로를 막으면 안 된다.
 */
export async function refreshCodes(): Promise<void> {
  try {
    const res = await apiFetch('/codes')
    if (!res.ok) return
    await replaceCodes((await res.json()) as CodesResponse)
  } catch {
    // 오프라인이거나 서버가 죽었다. 기존 캐시로 계속 간다.
  }
}
