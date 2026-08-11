import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'

const LOG_LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

export interface DailyLogStreamOptions {
  logDirectory: string
  now?: () => Date
  stdout?: NodeJS.WritableStream
}

export function formatLogTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDateForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

export function dailyLogFilename(date: Date, today: Date): string {
  const isToday = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()

  return isToday ? 'daily-api.log' : `daily-api-${formatDateForFilename(date)}.log`
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function renderLine(rawLine: string, fallbackTime: Date): string {
  const record = JSON.parse(rawLine) as Record<string, unknown>
  const timestamp = typeof record.time === 'number' ? new Date(record.time) : fallbackTime
  const level = typeof record.level === 'number' ? (LOG_LEVELS[record.level] ?? String(record.level)) : 'INFO'
  const message = typeof record.msg === 'string' ? record.msg : ''
  const { level: _level, msg: _message, time: _time, pid: _pid, hostname: _hostname, ...context } = record
  const contextText = Object.keys(context).length === 0 ? '' : ` ${JSON.stringify(context)}`

  return `${formatLogTimestamp(timestamp)} ${level}${message ? ` ${message}` : ''}${contextText}\n`
}

export function createDailyLogStream({
  logDirectory,
  now = () => new Date(),
  stdout = process.stdout,
}: DailyLogStreamOptions): Writable {
  mkdirSync(logDirectory, { recursive: true })

  const undatedPath = join(logDirectory, 'daily-api.log')
  const startupDate = now()
  if (existsSync(undatedPath)) {
    const previousWriteDate = statSync(undatedPath).mtime
    if (!isSameDay(previousWriteDate, startupDate)) {
      renameSync(undatedPath, join(logDirectory, `daily-api-${formatDateForFilename(previousWriteDate)}.log`))
    }
  }

  let activeDate: Date | undefined
  let buffered = ''

  function writeLine(rawLine: string): void {
    if (!rawLine) return

    const currentDate = now()
    if (activeDate && !isSameDay(activeDate, currentDate)) {
      renameSync(
        undatedPath,
        join(logDirectory, `daily-api-${formatDateForFilename(activeDate)}.log`),
      )
    }
    activeDate = currentDate

    const output = renderLine(rawLine, currentDate)
    appendFileSync(join(logDirectory, dailyLogFilename(currentDate, currentDate)), output)
    stdout.write(output)
  }

  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        buffered += chunk.toString()
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) writeLine(line)
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
    final(callback) {
      try {
        writeLine(buffered)
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
  })
}
