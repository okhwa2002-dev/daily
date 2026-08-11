import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createDailyLogStream, dailyLogFilename, formatLogTimestamp } from './daily-logger.ts'

describe('daily logger', () => {
  it('formats the log creation timestamp as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatLogTimestamp(new Date(2026, 7, 11, 4, 5, 6))).toBe('2026-08-11 04:05:06')
  })

  it('uses an undated filename only for today', () => {
    const today = new Date(2026, 7, 11, 12)

    expect(dailyLogFilename(today, today)).toBe('daily-api.log')
    expect(dailyLogFilename(new Date(2026, 7, 10, 12), today)).toBe('daily-api-20260810.log')
  })

  it('writes a newline-terminated dated line to stdout and today\'s file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
    let consoleText = ''
    const stdout = new Writable({
      write(chunk, _encoding, done) {
        consoleText += chunk
        done()
      },
    })
    const stream = createDailyLogStream({
      logDirectory: directory,
      now: () => new Date(2026, 7, 11, 4, 5, 6),
      stdout,
    })

    stream.end('{"level":30,"msg":"ready"}\n')
    await new Promise<void>((resolve) => stream.once('finish', resolve))

    const fileText = await readFile(join(directory, 'daily-api.log'), 'utf8')
    expect(fileText).toBe('2026-08-11 04:05:06 INFO ready\n')
    expect(consoleText).toBe(fileText)
  })

  it('renames the prior today file when the date changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
    let current = new Date(2026, 7, 11, 23, 59, 59)
    const stream = createDailyLogStream({
      logDirectory: directory,
      now: () => current,
      stdout: new Writable({ write(_chunk, _encoding, done) { done() } }),
    })

    stream.write('{"level":30,"msg":"before midnight"}\n')
    current = new Date(2026, 7, 12, 0, 0, 1)
    stream.end('{"level":30,"msg":"after midnight"}\n')
    await new Promise<void>((resolve) => stream.once('finish', resolve))

    expect(await readFile(join(directory, 'daily-api-20260811.log'), 'utf8')).toContain('before midnight')
    expect(await readFile(join(directory, 'daily-api.log'), 'utf8')).toContain('after midnight')
  })

  it('archives a stale today file when the server starts on a new date', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
    const yesterday = new Date(2026, 7, 11, 23, 59, 59)
    const undatedFile = join(directory, 'daily-api.log')
    await writeFile(undatedFile, 'previous day\n')
    await utimes(undatedFile, yesterday, yesterday)
    const stream = createDailyLogStream({
      logDirectory: directory,
      now: () => new Date(2026, 7, 12, 0, 0, 1),
      stdout: new Writable({ write(_chunk, _encoding, done) { done() } }),
    })

    stream.end('{"level":30,"msg":"new day"}\n')
    await new Promise<void>((resolve) => stream.once('finish', resolve))

    expect(await readFile(join(directory, 'daily-api-20260811.log'), 'utf8')).toBe('previous day\n')
    expect(await readFile(undatedFile, 'utf8')).toContain('new day')
  })
})
