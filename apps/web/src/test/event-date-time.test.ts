import { describe, expect, it } from 'vitest'
import { formatInstantInTimeZone, instantPlusMilliseconds, localDateDayDifference, millisecondsBetweenLocalDateTimes, resolveLocalDateTime, shiftLocalDateTime } from '../features/eventDateTime'

describe('event date/time conversion', () => {
  it('resolves a valid venue-local time to an instant and formats it back', () => {
    const resolved = resolveLocalDateTime('2026-10-08T19:30', 'Europe/Dublin')
    expect(resolved.kind).toBe('valid')
    if (resolved.kind !== 'valid') return
    expect(resolved.instant.toISOString()).toBe('2026-10-08T18:30:00.000Z')
    expect(formatInstantInTimeZone(resolved.instant, 'Europe/Dublin')).toBe('2026-10-08T19:30')
  })

  it('rejects nonexistent and ambiguous local times around daylight-saving changes', () => {
    expect(resolveLocalDateTime('2026-03-29T01:30', 'Europe/Dublin')).toEqual({ kind: 'nonexistent' })
    expect(resolveLocalDateTime('2026-10-25T01:30', 'Europe/Dublin')).toEqual({ kind: 'ambiguous' })
  })

  it('keeps elapsed duration when deriving an end time from a start', () => {
    expect(instantPlusMilliseconds('2026-03-29T00:30:00.000Z', 3 * 60 * 60 * 1000, 'Europe/Dublin'))
      .toBe('2026-03-29T04:30')
  })

  it('measures local durations and shifts a copied event across calendar days', () => {
    expect(millisecondsBetweenLocalDateTimes('2026-10-08T19:00', '2026-10-08T22:00', 'Europe/Dublin'))
      .toBe(3 * 60 * 60 * 1000)
    expect(localDateDayDifference('2026-10-08T00:00', '2026-10-10T00:00')).toBe(2)
    expect(shiftLocalDateTime('2026-10-08T23:30', 2, 'Europe/Dublin')).toBe('2026-10-10T23:30')
  })
})
