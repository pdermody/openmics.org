type DateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export type LocalDateTimeResolution =
  | { kind: 'valid'; instant: Date }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous' }

function partsMatch(actual: DateTimeParts, expected: DateTimeParts): boolean {
  return actual.year === expected.year
    && actual.month === expected.month
    && actual.day === expected.day
    && actual.hour === expected.hour
    && actual.minute === expected.minute
}

function readParts(instant: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function utcMilliseconds(parts: DateTimeParts): number {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  return date.getTime()
}

function offsetAt(instant: Date, timeZone: string): number {
  const roundedInstant = Math.floor(instant.getTime() / 1000) * 1000
  return utcMilliseconds(readParts(instant, timeZone)) - roundedInstant
}

function parseLocalDateTime(value: string): DateTimeParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const parts: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  }
  const check = new Date(utcMilliseconds(parts))
  if (check.getUTCFullYear() !== parts.year
    || check.getUTCMonth() + 1 !== parts.month
    || check.getUTCDate() !== parts.day
    || parts.hour > 23
    || parts.minute > 59) return undefined
  return parts
}

export function resolveLocalDateTime(value: string, timeZone: string): LocalDateTimeResolution {
  const parts = parseLocalDateTime(value)
  if (!parts) return { kind: 'nonexistent' }
  const wallTime = utcMilliseconds(parts)
  const sampleOffsets = [-36, -12, 0, 12, 36].map((hours) => (
    offsetAt(new Date(wallTime + hours * 60 * 60 * 1000), timeZone)
  ))
  const candidates = [...new Set(sampleOffsets)]
    .map((offset) => new Date(wallTime - offset))
    .filter((candidate) => {
      const actual = readParts(candidate, timeZone)
      return partsMatch(actual, parts)
    })
  if (candidates.length === 0) return { kind: 'nonexistent' }
  if (candidates.length > 1) return { kind: 'ambiguous' }
  return { kind: 'valid', instant: candidates[0] }
}

export function formatInstantInTimeZone(value: string | Date, timeZone: string): string {
  const parts = readParts(value instanceof Date ? value : new Date(value), timeZone)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(0)
  value.setUTCFullYear(year, month - 1, day + days)
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

export function shiftLocalDateTime(value: string, dayDelta: number, timeZone: string): string | undefined {
  const parts = parseLocalDateTime(value)
  if (!parts) return undefined
  const date = addCalendarDays(value.slice(0, 10), dayDelta)
  const shifted = `${date}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  return resolveLocalDateTime(shifted, timeZone).kind === 'valid' ? shifted : undefined
}

export function instantPlusMilliseconds(value: string, milliseconds: number, timeZone: string): string {
  return formatInstantInTimeZone(new Date(new Date(value).getTime() + milliseconds), timeZone)
}

export function millisecondsBetweenLocalDateTimes(start: string, end: string, timeZone: string): number | undefined {
  const resolvedStart = resolveLocalDateTime(start, timeZone)
  const resolvedEnd = resolveLocalDateTime(end, timeZone)
  if (resolvedStart.kind !== 'valid' || resolvedEnd.kind !== 'valid') return undefined
  return resolvedEnd.instant.getTime() - resolvedStart.instant.getTime()
}

export function localDateDayDifference(start: string, end: string): number | undefined {
  const startParts = parseLocalDateTime(start)
  const endParts = parseLocalDateTime(end)
  if (!startParts || !endParts) return undefined
  return Math.round((utcMilliseconds({ ...endParts, hour: 0, minute: 0, second: 0 })
    - utcMilliseconds({ ...startParts, hour: 0, minute: 0, second: 0 })) / (24 * 60 * 60 * 1000))
}
