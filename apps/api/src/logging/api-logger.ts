import pino, { type Logger } from 'pino'
import { createDailyLogStream } from './daily-logger.ts'

const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.password',
]

export interface ApiLoggerOptions {
  environment: string | undefined
  logDirectory: string
  stdout?: NodeJS.WritableStream
}

export function createApiLogger({ environment, logDirectory, stdout }: ApiLoggerOptions): Logger {
  const options = { level: environment === 'test' ? 'silent' : 'info', redact: REDACTED_PATHS }

  if (environment === 'test') return pino(options)

  return pino(options, createDailyLogStream({ logDirectory, stdout }))
}
