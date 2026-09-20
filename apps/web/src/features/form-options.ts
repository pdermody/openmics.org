import { countries } from 'countries-list'

export type CountryOption = { code: string; name: string }

export const ACTIVITY_LABEL_KEYS = {
  singing: 'activitySinging',
  poetry: 'activityPoetry',
  jam: 'activityJam',
  trad: 'activityTrad',
  comedy: 'activityComedy',
  storytelling: 'activityStorytelling',
  other: 'activityOther',
} as const

export const COUNTRY_OPTIONS: CountryOption[] = Object.entries(countries)
  .map(([code, country]) => ({ code, name: country.name }))
  .sort((left, right) => left.name.localeCompare(right.name))

const FALLBACK_TIME_ZONES = ['UTC', 'Europe/Dublin', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

function timeZoneOffsetMinutes(timeZone: string, date = new Date()): number {
  try {
    const offset = new Intl.DateTimeFormat('en', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
    const match = offset.match(/^GMT(?:([+-])(\d{2}):?(\d{2})?)?$/)
    if (!match?.[1]) return 0
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
    return match[1] === '+' ? minutes : -minutes
  } catch {
    return 0
  }
}

const availableTimeZones: string[] = typeof Intl.supportedValuesOf === 'function'
  ? ['UTC', ...Intl.supportedValuesOf('timeZone')]
  : FALLBACK_TIME_ZONES

export const TIME_ZONE_OPTIONS: string[] = availableTimeZones.sort((left, right) => (
  timeZoneOffsetMinutes(left) - timeZoneOffsetMinutes(right) || left.localeCompare(right)
))

export function formatTimeZoneOption(timeZone: string, date = new Date()): string {
  try {
    const offset = new Intl.DateTimeFormat('en', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
    const normalizedOffset = offset === 'GMT' ? 'UTC+00:00' : offset.replace(/^GMT/, 'UTC')
    const displayName = timeZone.includes('/')
      ? timeZone.split('/').slice(1).join('/').replaceAll('_', ' ')
      : timeZone
    return `${displayName} (${normalizedOffset})`
  } catch {
    return timeZone
  }
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return zone === 'Etc/UTC' ? 'UTC' : zone
  } catch {
    return 'UTC'
  }
}
