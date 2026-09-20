import { describe, expect, it } from 'vitest'
import { COUNTRY_OPTIONS, formatTimeZoneOption, TIME_ZONE_OPTIONS, browserTimeZone } from '../features/form-options'

describe('series form options', () => {
  it('provides the full country code/name list in stable order', () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200)
    expect(COUNTRY_OPTIONS).toContainEqual({ code: 'IE', name: 'Ireland' })
    expect(COUNTRY_OPTIONS).toContainEqual({ code: 'US', name: 'United States' })
    expect(COUNTRY_OPTIONS.map((country) => country.name)).toEqual([...COUNTRY_OPTIONS].sort((left, right) => left.name.localeCompare(right.name)).map((country) => country.name))
  })

  it('provides IANA timezone identifiers and a browser suggestion', () => {
    expect(TIME_ZONE_OPTIONS).toContain('Europe/Dublin')
    expect(TIME_ZONE_OPTIONS).toContain('UTC')
    expect(browserTimeZone()).toEqual(expect.any(String))
  })

  it('shows the timezone UTC offset explicitly', () => {
    expect(formatTimeZoneOption('Europe/Dublin', new Date('2026-01-15T12:00:00Z'))).toBe('Dublin (UTC+00:00)')
    expect(formatTimeZoneOption('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('New York (UTC-05:00)')
  })

  it('orders timezone options by current UTC offset, then name', () => {
    const dublinIndex = TIME_ZONE_OPTIONS.indexOf('Europe/Dublin')
    const londonIndex = TIME_ZONE_OPTIONS.indexOf('Europe/London')
    const parisIndex = TIME_ZONE_OPTIONS.indexOf('Europe/Paris')
    expect(dublinIndex).toBeLessThan(parisIndex)
    expect(londonIndex).toBeLessThan(parisIndex)
  })
})
