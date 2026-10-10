import type { TFunction } from 'i18next'
import type { Event, OpenMic } from './publicReads'

export function isOpenMicsWebsite(website: string) {
  const hostname = new URL(website).hostname.toLowerCase().replace(/\.$/, '')
  return hostname === 'openmics.org' || hostname.endsWith('.openmics.org')
}

export function entryFee(resource: Pick<OpenMic, 'entry_fee_amount' | 'entry_fee_currency' | 'entry_fee_note'>, locale: string, t: TFunction) {
  if (resource.entry_fee_note) return resource.entry_fee_note
  const amount = resource.entry_fee_amount
  if (amount === 0) return t('freeEntry')
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(resource.entry_fee_currency ?? '')) return t('entryFeeNotSpecified')
  return new Intl.NumberFormat(locale, { style: 'currency', currency: resource.entry_fee_currency!, currencyDisplay: 'code' }).format(amount)
}

export function eventTimeRange(event: Pick<Event, 'starts_at' | 'ends_at' | 'time_zone'>, locale: string, t: TFunction) {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.time_zone })
  const start = format.format(new Date(event.starts_at))
  return `${start} - ${event.ends_at ? format.format(new Date(event.ends_at)) : t('endTimeNotSpecified')} (${event.time_zone})`
}

export function navigationDestination(location: { lat?: number | null; lng?: number | null; address_line1?: string; address_line2?: string | null; postcode?: string | null; city: string; country: string }) {
  const precise = typeof location.lat === 'number' && Number.isFinite(location.lat) && Math.abs(location.lat) <= 90
    && typeof location.lng === 'number' && Number.isFinite(location.lng) && Math.abs(location.lng) <= 180
  const address = [location.address_line1, location.address_line2, location.postcode, location.city, location.country].filter(Boolean).join(', ')
  const destination = precise ? `${location.lat},${location.lng}` : location.address_line1 && location.city && location.country ? address : null
  return { precise, address, destination }
}
