import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { expect, it } from 'vitest'
import { createDailyLogStream, dailyLogFilename, formatLogTimestamp } from './daily-logger.ts'

/** 콘솔 출력을 문자열로 모으는 스텁. 실제 stdout을 더럽히지 않는다. */
function captureStdout(): { stream: Writable; text: () => string } {
  let text = ''
  const stream = new Writable({ write(chunk, _encoding, done) { text += String(chunk); done() } })
  return { stream, text: () => text }
}

function finished(stream: Writable): Promise<void> {
  return new Promise((resolve) => stream.once('finish', resolve))
}

it('ISO 구분자 없이 로컬 로그 시각을 만든다', () => {
  expect(formatLogTimestamp(new Date(2026, 7, 11, 4, 5, 6))).toBe('2026-08-11 04:05:06')
})

it('날짜 없는 파일명은 오늘에만 쓴다', () => {
  const today = new Date(2026, 7, 11, 12)
  expect(dailyLogFilename(today, today)).toBe('daily-api.log')
  expect(dailyLogFilename(new Date(2026, 7, 10, 12), today)).toBe('daily-api-20260810.log')
})

it('한 줄짜리 로그를 stdout과 오늘 파일 양쪽에 쓴다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
  const stdout = captureStdout()
  const stream = createDailyLogStream({
    logDirectory: directory,
    now: () => new Date(2026, 7, 11, 4, 5, 6),
    stdout: stdout.stream,
  })

  stream.end('{"level":30,"msg":"ready"}\n')
  await finished(stream)

  const fileText = await readFile(join(directory, 'daily-api.log'), 'utf8')
  expect(fileText).toBe('2026-08-11 04:05:06 INFO ready\n')
  expect(stdout.text()).toBe(fileText)
})

it('날짜가 바뀌면 직전 당일 파일의 이름을 바꾼다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
  let current = new Date(2026, 7, 11, 23, 59, 59)
  const stream = createDailyLogStream({
    logDirectory: directory,
    now: () => current,
    stdout: captureStdout().stream,
  })

  stream.write('{"level":30,"msg":"before midnight"}\n')
  current = new Date(2026, 7, 12, 0, 0, 1)
  stream.end('{"level":30,"msg":"after midnight"}\n')
  await finished(stream)

  expect(await readFile(join(directory, 'daily-api-20260811.log'), 'utf8')).toContain('before midnight')
  expect(await readFile(join(directory, 'daily-api.log'), 'utf8')).toContain('after midnight')
})

it('재시작으로 프로세스 기록이 없어도 어제 남은 당일 파일을 넘긴다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
  const activePath = join(directory, 'daily-api.log')
  // 어제 죽은 프로세스가 남기고 간 파일. 날짜 판단 근거는 mtime뿐이다.
  await writeFile(activePath, '2026-08-11 23:00:00 INFO yesterday\n')
  const yesterday = new Date(2026, 7, 11, 23)
  await utimes(activePath, yesterday, yesterday)

  const stream = createDailyLogStream({
    logDirectory: directory,
    now: () => new Date(2026, 7, 12, 9, 0, 0),
    stdout: captureStdout().stream,
  })
  stream.end('{"level":30,"msg":"today"}\n')
  await finished(stream)

  expect(await readFile(join(directory, 'daily-api-20260811.log'), 'utf8')).toContain('yesterday')
  const active = await readFile(activePath, 'utf8')
  expect(active).toBe('2026-08-12 09:00:00 INFO today\n')
})
