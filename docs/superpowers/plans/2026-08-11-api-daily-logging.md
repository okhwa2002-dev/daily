# API Daily Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store API logs in the external daily log directory using the required daily filename convention, while emitting the same dated lines to the console.

**Architecture:** A focused `daily-logger` module owns date calculation, one-line rendering, directory creation, and the writable stream that switches files at midnight. `app.ts` receives a configured Pino logger from that module in non-test environments, retaining Fastify's current redaction and request logging behavior. The custom stream writes every rendered line to both `process.stdout` and the active daily file.

**Tech Stack:** Node.js 22 filesystem streams, TypeScript, Pino 10, Fastify 5, Vitest 4.

## Global Constraints

- Log directory: `D:\workspace\ok2020\log\daily`.
- Today's filename: `daily-api.log`; archived filename: `daily-api-YYYYMMDD.log`, with an eight-digit date and no separator.
- Each console and file record ends in exactly one newline and starts with a generated `YYYY-MM-DD HH:mm:ss` timestamp.
- Do not log passwords, tokens, sessions, cookies, authorization headers, user content, or email addresses; preserve the existing Pino redaction list.
- Do not add a logging dependency.
- `NODE_ENV === 'test'` must keep logging silent and must not access the external log directory.

---

### Task 1: Create and test the daily dual-output log stream

**Files:**
- Create: `apps/api/src/logging/daily-logger.ts`
- Create: `apps/api/src/logging/daily-logger.test.ts`

**Interfaces:**
- Produces: `formatLogTimestamp(date: Date): string`, `dailyLogFilename(date: Date, today: Date): string`, and `createDailyLogStream(options): Writable`.
- `createDailyLogStream(options)` accepts `{ logDirectory: string; now?: () => Date; stdout?: NodeJS.WritableStream }` and returns a Node writable stream accepted as Pino's destination.
- The stream consumes Pino's newline-terminated JSON records and emits `YYYY-MM-DD HH:mm:ss <level> <message> <remaining JSON fields>\n` to `stdout` and the selected file.

- [ ] **Step 1: Write the failing unit tests**

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createDailyLogStream, dailyLogFilename, formatLogTimestamp } from './daily-logger.ts'

it('formats a local log timestamp without ISO separators', () => {
  expect(formatLogTimestamp(new Date(2026, 7, 11, 4, 5, 6))).toBe('2026-08-11 04:05:06')
})

it('uses the undated filename only for today', () => {
  const today = new Date(2026, 7, 11, 12)
  expect(dailyLogFilename(today, today)).toBe('daily-api.log')
  expect(dailyLogFilename(new Date(2026, 7, 10, 12), today)).toBe('daily-api-20260810.log')
})

it('writes one dated line to both stdout and today\'s file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
  let consoleText = ''
  const stdout = new Writable({ write(chunk, _encoding, done) { consoleText += chunk; done() } })
  const stream = createDailyLogStream({ logDirectory: directory, now: () => new Date(2026, 7, 11, 4, 5, 6), stdout })
  stream.end('{"level":30,"msg":"ready"}\n')
  await new Promise<void>((resolve) => stream.once('finish', resolve))
  const fileText = await readFile(join(directory, 'daily-api.log'), 'utf8')
  expect(fileText).toBe('2026-08-11 04:05:06 INFO ready\\n')
  expect(consoleText).toBe(fileText)
})
```

- [ ] **Step 2: Run the new test file and verify it fails because `daily-logger.ts` does not exist**

Run: `pnpm --filter @daily/api test -- src/logging/daily-logger.test.ts`

Expected: FAIL with an unresolved import for `./daily-logger.ts`.

- [ ] **Step 3: Implement the minimal daily log stream**

```ts
export function formatLogTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function dailyLogFilename(date: Date, today: Date): string {
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  return sameDay ? 'daily-api.log' : `daily-api-${formatDateForFilename(date)}.log`
}
```

Implement `createDailyLogStream` as a `Writable` that creates `logDirectory` recursively, parses each Pino JSON line, maps numeric Pino levels to `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, or `FATAL`, renders one newline-terminated line, and synchronously appends it to the currently selected file plus `stdout`. On a date change, rename the previously active `daily-api.log` to `daily-api-YYYYMMDD.log` before opening the new undated file. Throw filesystem failures from the stream write callback so Fastify reports the logging failure.

- [ ] **Step 4: Run the daily logger test file and verify it passes**

Run: `pnpm --filter @daily/api test -- src/logging/daily-logger.test.ts`

Expected: PASS with all three tests green.

- [ ] **Step 5: Add the rollover regression test, verify red, then implement it**

```ts
it('renames the prior today file when the date changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daily-log-'))
  let current = new Date(2026, 7, 11, 23, 59, 59)
  const stream = createDailyLogStream({ logDirectory: directory, now: () => current, stdout: new Writable({ write(_chunk, _encoding, done) { done() } }) })
  stream.write('{"level":30,"msg":"before midnight"}\n')
  current = new Date(2026, 7, 12, 0, 0, 1)
  stream.end('{"level":30,"msg":"after midnight"}\n')
  await new Promise<void>((resolve) => stream.once('finish', resolve))
  expect(await readFile(join(directory, 'daily-api-20260811.log'), 'utf8')).toContain('before midnight')
  expect(await readFile(join(directory, 'daily-api.log'), 'utf8')).toContain('after midnight')
})
```

Run the targeted test first and confirm it fails for the missing rotation behavior. Add the rollover branch described in Step 3, then rerun the file and confirm all four tests pass.

- [ ] **Step 6: Commit the isolated logging component**

```bash
git add apps/api/src/logging/daily-logger.ts apps/api/src/logging/daily-logger.test.ts
git commit -m "feat(api): add daily log stream"
```

### Task 2: Configure Fastify to use the daily stream in non-test environments

**Files:**
- Modify: `apps/api/src/app.ts:1-25`
- Modify: `apps/api/ecosystem.config.cjs:12-14`
- Test: `apps/api/src/app.test.ts` (create if no suitable app-construction test exists)

**Interfaces:**
- Consumes: `createDailyLogStream({ logDirectory: 'D:\\workspace\\ok2020\\log\\daily' })` from `src/logging/daily-logger.ts`.
- Produces: `buildApp()` whose production logger writes to both destinations; test builds retain `{ level: 'silent' }` and do not initialize the stream.

- [ ] **Step 1: Write the failing app-construction test for test-environment isolation**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const createDailyLogStream = vi.fn()
vi.mock('./logging/daily-logger.ts', () => ({ createDailyLogStream }))

afterEach(() => vi.resetModules())

it('does not initialize the file logger in test mode', async () => {
  vi.stubEnv('NODE_ENV', 'test')
  const { buildApp } = await import('./app.ts')
  const app = await buildApp()
  await app.close()
  expect(createDailyLogStream).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test and verify it fails before the integration exists**

Run: `pnpm --filter @daily/api test -- src/app.test.ts`

Expected: FAIL because the new test file or logger mock target is not yet present.

- [ ] **Step 3: Pass the configured Pino logger to Fastify**

```ts
const logger = env.NODE_ENV === 'test'
  ? { level: 'silent' as const }
  : pino({ level: 'info', redact: REDACTED_PATHS }, createDailyLogStream({
      logDirectory: 'D:\\workspace\\ok2020\\log\\daily',
    }))

const app = Fastify({ logger, trustProxy: 1 })
```

Import `pino` and `createDailyLogStream`, extract the existing redaction array into `REDACTED_PATHS`, and retain the existing `env.NODE_ENV === 'test'` level behavior. Remove PM2's `error_file`, `out_file`, and `time` settings to prevent a second, incompatible log set; leave process supervision settings unchanged.

- [ ] **Step 4: Run the app-construction test and API suite**

Run: `pnpm --filter @daily/api test -- src/app.test.ts && pnpm --filter @daily/api test`

Expected: PASS; no test run creates or accesses `D:\workspace\ok2020\log\daily`.

- [ ] **Step 5: Run type checking and production build**

Run: `pnpm typecheck && pnpm build`

Expected: both commands exit 0.

- [ ] **Step 6: Commit the Fastify integration**

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts apps/api/ecosystem.config.cjs
git commit -m "feat(api): configure daily file logging"
```

## Final verification

- [ ] Run `pnpm --filter @daily/api test`, `pnpm typecheck`, and `pnpm build` from the workspace root.
- [ ] Start the API with `NODE_ENV=production`, issue `GET /api/health`, and inspect `D:\workspace\ok2020\log\daily\daily-api.log` plus console output. Confirm both contain newline-terminated records with `YYYY-MM-DD HH:mm:ss` timestamps and contain no redacted secret values.
