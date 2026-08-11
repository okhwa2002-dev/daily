import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createApiLogger } from './api-logger.ts'

describe('createApiLogger', () => {
  it('sends a production Pino record to the configured daily log stream', async () => {
    const logDirectory = await mkdtemp(join(tmpdir(), 'daily-api-'))
    let consoleText = ''
    const stdout = new Writable({
      write(chunk, _encoding, done) {
        consoleText += chunk
        done()
      },
    })
    const logger = createApiLogger({ environment: 'production', logDirectory, stdout })

    logger.info('API ready')
    await new Promise<void>((resolve, reject) => logger.flush((error) => {
      if (error) reject(error)
      else resolve()
    }))

    const fileText = await readFile(join(logDirectory, 'daily-api.log'), 'utf8')
    expect(fileText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} INFO API ready\n$/)
    expect(consoleText).toBe(fileText)
  })

  it('keeps test loggers silent without creating a daily log directory', () => {
    const logger = createApiLogger({
      environment: 'test',
      logDirectory: join(tmpdir(), `daily-api-not-created-${Date.now()}`),
    })

    expect(logger.level).toBe('silent')
  })
})
