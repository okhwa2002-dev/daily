import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'

/** 오늘 기록 중인 파일. 날짜가 바뀌면 아래 ARCHIVE 이름으로 넘긴다. */
const ACTIVE_FILENAME = 'daily-api.log'

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL',
}

// 한 줄 렌더링에서 이미 자기 자리를 가진 필드(level·msg)와, 매 줄 똑같이 반복돼
// 잡음만 되는 필드(time·pid·hostname)는 뒤에 붙는 남은 필드 JSON에서 뺀다.
// 시각은 now()로 직접 찍으므로 pino의 time은 쓰지 않는다.
const RENDERED_KEYS = new Set(['level', 'msg', 'time', 'pid', 'hostname'])

/** 개행 자리를 잠시 대신할 사설 영역(U+E000) 문자. */
const NEWLINE_MARK = String.fromCharCode(0xe000)

const pad = (value: number) => String(value).padStart(2, '0')

export function formatLogTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDateForFilename(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export function dailyLogFilename(date: Date, today: Date): string {
  return isSameDay(date, today) ? ACTIVE_FILENAME : `daily-api-${formatDateForFilename(date)}.log`
}

/** 문자열 값 안의 실제 개행만 표시자로 바꾼다. 다른 타입은 그대로 둔다. */
function markNewlines(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\n', NEWLINE_MARK)
  if (Array.isArray(value)) return value.map(markNewlines)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, markNewlines(item)]),
    )
  }
  return value
}

/**
 * 남은 필드를 JSON으로 직렬화하되 값 안의 개행은 실제 줄바꿈으로 남긴다.
 * `JSON.stringify`는 개행을 `\n` 두 글자로 escape해서 스택 트레이스가 한 줄에
 * 뭉개진다.
 *
 * 직렬화된 결과에서 `\n`을 일괄 치환하지 않는 이유는, 사용자가 입력한 `\n`
 * 두 글자(escape되어 `\\n`이 된 것)까지 줄바꿈으로 바뀌기 때문이다. 직렬화
 * 전에 진짜 개행만 표시해 두면 그 구분이 유지된다.
 */
export function stringifyWithNewlines(value: unknown): string {
  return JSON.stringify(markNewlines(value)).replaceAll(NEWLINE_MARK, '\n')
}

export interface DailyLogStreamOptions {
  /** 로그 파일을 둘 디렉터리. 없으면 만든다. */
  logDirectory: string
  /** 현재 시각 공급자. 테스트에서 날짜 전환을 재현하려고 주입한다. */
  now?: () => Date
  /** 파일과 함께 같은 줄을 받을 콘솔 스트림. */
  stdout?: NodeJS.WritableStream
}

/**
 * pino가 뱉는 JSON 줄을 사람이 읽는 한 줄로 바꿔 콘솔과 당일 파일에 동시에 쓴다.
 * 날짜가 바뀌면 전날 파일을 날짜 포함 이름으로 넘기고 새 당일 파일을 연다.
 */
export function createDailyLogStream(options: DailyLogStreamOptions): Writable {
  const { logDirectory, now = () => new Date(), stdout = process.stdout } = options

  // 디렉터리를 못 만들면 로그가 통째로 사라진다. 서버가 뜨기 전에 여기서 던져
  // 기동을 막는다. 로그 유실 상태로 running인 편이 더 나쁘다.
  mkdirSync(logDirectory, { recursive: true })

  const activePath = join(logDirectory, ACTIVE_FILENAME)
  /** 현재 당일 파일이 어느 날짜의 것인지. 이 프로세스가 아직 안 썼으면 null. */
  let activeDate: Date | null = null
  /** 개행 앞에서 잘린 조각. 다음 청크와 이어 붙인다. */
  let pending = ''

  /**
   * 당일 파일이 속한 날짜. 재시작 직후라면 이 프로세스에는 기록이 없으므로
   * 파일 mtime으로 판단한다. 이게 없으면 재시작을 낀 자정 전환에서 어제 줄과
   * 오늘 줄이 한 파일에 섞인다.
   */
  function activeFileDate(): Date | null {
    if (activeDate) return activeDate
    if (!existsSync(activePath)) return null
    return statSync(activePath).mtime
  }

  function rollIfNeeded(current: Date): void {
    const previous = activeFileDate()
    activeDate = current
    if (!previous || isSameDay(previous, current)) return

    const archivePath = join(logDirectory, dailyLogFilename(previous, current))
    // Windows의 rename은 대상이 이미 있으면 실패한다. 같은 날짜 보관 파일이
    // 남아 있는 경우(같은 날 여러 번 재시작)에는 이어 붙이고 원본을 지운다.
    if (existsSync(archivePath)) {
      appendFileSync(archivePath, readFileSync(activePath))
      unlinkSync(activePath)
      return
    }
    renameSync(activePath, archivePath)
  }

  function renderLine(record: string, at: Date): string {
    const timestamp = formatLogTimestamp(at)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(record) as Record<string, unknown>
    } catch {
      // pino가 아닌 곳에서 흘러든 줄. 버리지 않고 시각만 붙여 그대로 남긴다.
      return `${timestamp} INFO ${record}\n`
    }

    const level = LEVEL_LABELS[Number(parsed.level)] ?? String(parsed.level ?? '')
    const message = typeof parsed.msg === 'string' ? parsed.msg : ''
    const rest = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => !RENDERED_KEYS.has(key)),
    )
    const restText = Object.keys(rest).length > 0 ? ` ${stringifyWithNewlines(rest)}` : ''
    return `${timestamp} ${level} ${message}${restText}\n`
  }

  function emit(records: string[]): void {
    const at = now()
    rollIfNeeded(at)
    const text = records.map((record) => renderLine(record, at)).join('')
    if (text.length === 0) return
    // 파일을 먼저 쓴다. 콘솔은 남았는데 파일이 비는 상황을 만들지 않는다.
    appendFileSync(activePath, text)
    stdout.write(text)
  }

  return new Writable({
    write(chunk, _encoding, done) {
      try {
        pending += String(chunk)
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        emit(lines.filter((line) => line.length > 0))
        done()
      } catch (error) {
        // 기록 대상이 불분명한 채로 계속 돌지 않는다. 호출자에게 전파한다.
        done(error as Error)
      }
    },
    final(done) {
      try {
        if (pending.length > 0) {
          emit([pending])
          pending = ''
        }
        done()
      } catch (error) {
        done(error as Error)
      }
    },
  })
}
