import { Writable } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 실제 스트림을 만들면 테스트가 외부 로그 디렉터리를 건드린다. 목이 돌려주는
// 싱크로 pino의 출력을 통째로 버린다.
const createDailyLogStream = vi.fn(() => new Writable({ write(_c, _e, done) { done() } }))
vi.mock('./logging/daily-logger.ts', () => ({ createDailyLogStream }))

beforeEach(() => {
  // env.ts는 import 시점에 process.env를 한 번만 읽는다. 환경별 분기를 보려면
  // 스텁을 세운 뒤 모듈 그래프를 새로 만들어야 한다.
  vi.resetModules()
  createDailyLogStream.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('테스트 환경에서는 파일 로거를 만들지 않는다', async () => {
  vi.stubEnv('NODE_ENV', 'test')

  const { buildApp } = await import('./app.ts')
  const app = await buildApp()
  await app.close()

  expect(createDailyLogStream).not.toHaveBeenCalled()
})

it('운영 환경에서는 LOG_DIR 디렉터리로 로그 스트림을 만든다', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_DIR', 'D:\\tmp\\daily-log-test')

  const { buildApp } = await import('./app.ts')
  const app = await buildApp()
  await app.close()

  expect(createDailyLogStream).toHaveBeenCalledWith({ logDirectory: 'D:\\tmp\\daily-log-test' })
})
