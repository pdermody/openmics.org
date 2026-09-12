import { describe, expect, it, vi } from 'vitest'
import { getCityCoordinates, isRegistrationClosed } from '../features/publicReads'

describe('public read helpers', () => {
  it('resolves seeded city coordinates case-insensitively and trims whitespace', () => {
    expect(getCityCoordinates(' Dublin ')).toEqual({ lat: 53.3498, lng: -6.2603 })
    expect(getCityCoordinates('unknown city')).toBeUndefined()
    expect(getCityCoordinates(null)).toBeUndefined()
  })

  it('treats only past or current closure timestamps as closed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))

    expect(isRegistrationClosed({ registrations_closed_at: null })).toBe(false)
    expect(isRegistrationClosed({ registrations_closed_at: '2026-09-12T11:59:59.000Z' })).toBe(true)
    expect(isRegistrationClosed({ registrations_closed_at: '2026-09-12T12:00:01.000Z' })).toBe(false)

    vi.useRealTimers()
  })
})