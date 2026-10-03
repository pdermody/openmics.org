import { i18n } from '../i18n'

// IMPORTANT: the token-substitution mechanics in this file mirror
// apps/api/src/media/captions.ts (used for server-side OG tags and alt text). The two
// copies MUST stay behavior-identical — mirrored unit tests pin the contract. Default
// captions are localized here via i18next (en/es); the server copy holds English-only
// defaults, which are only used for OG/alt output where localization is out of scope.

export type CaptionValues = {
  performerName?: string | null
  performerCity?: string | null
  eventName?: string | null
  /** Preformatted display date (localized by the caller). */
  eventDate?: string | null
}

export const CAPTION_TOKEN_NAMES = ['performer_name', 'performer_city', 'event_name', 'event_date'] as const
export type CaptionTokenName = (typeof CAPTION_TOKEN_NAMES)[number]

const TOKEN_PATTERN = /\{\s*(performer_name|performer_city|event_name|event_date)\s*\}/g

const TOKEN_VALUE_KEYS: Record<CaptionTokenName, keyof CaptionValues> = {
  performer_name: 'performerName',
  performer_city: 'performerCity',
  event_name: 'eventName',
  event_date: 'eventDate',
}

const SEPARATOR_CLASS = '—–\\-·•|,;:'
const SEPARATOR_RUN_START = new RegExp(`^[\\s${SEPARATOR_CLASS}]+`)
const SEPARATOR_RUN_END = new RegExp(`[\\s${SEPARATOR_CLASS}]+$`)
const SEPARATOR_ADJACENT = new RegExp(`([${SEPARATOR_CLASS}])\\s+(?=[${SEPARATOR_CLASS}])`, 'g')

/** Mirrors apps/api/src/media/captions.ts → substituteCaption. Keep behavior identical. */
export function substituteCaption(template: string, values: CaptionValues): string {
  let out = template.replace(TOKEN_PATTERN, (_match, name: CaptionTokenName) => {
    const value = values[TOKEN_VALUE_KEYS[name]]
    return value?.trim() ?? ''
  })

  let previous: string
  do {
    previous = out
    out = out.replace(/\s{2,}/g, ' ')
    out = out.replace(SEPARATOR_RUN_START, '')
    out = out.replace(SEPARATOR_RUN_END, '')
    out = out.replace(SEPARATOR_ADJACENT, '$1')
  } while (out !== previous)

  return out.trim()
}

/** Mirrors apps/api/src/media/captions.ts → availableCaptionTokens. */
export function availableCaptionTokens(scope: { attributed: boolean; eventScoped: boolean }): CaptionTokenName[] {
  const tokens: CaptionTokenName[] = []
  if (scope.attributed) tokens.push('performer_name', 'performer_city')
  if (scope.eventScoped) tokens.push('event_name', 'event_date')
  return tokens
}

/**
 * Localized default caption (design §7.2, §7.3): paired with-city / no-city keys so a
 * missing city never leaves a hole. Free-standing media has no default ('').
 */
export function defaultCaption(values: CaptionValues, form: 'short' | 'long'): string {
  const name = values.performerName?.trim() || null
  const city = values.performerCity?.trim() || null
  if (!name) return ''
  const performer = city
    ? i18n.t('mediaCaptionPerformerWithCity', { name, city })
    : i18n.t('mediaCaptionPerformerNoCity', { name })
  if (form === 'short') return performer
  const eventName = values.eventName?.trim() || null
  const eventDate = values.eventDate?.trim() || null
  if (eventName && eventDate) return i18n.t('mediaCaptionLongEventDate', { performer, event: eventName, date: eventDate })
  if (eventName) return i18n.t('mediaCaptionLongEvent', { performer, event: eventName })
  if (eventDate) return i18n.t('mediaCaptionLongDate', { performer, date: eventDate })
  return performer
}

/** The caption as displayed in the gallery: organizer template substituted, else the default. */
export function resolveCaption(caption: string | null, values: CaptionValues, form: 'short' | 'long'): string {
  if (caption?.trim()) return substituteCaption(caption, values)
  return defaultCaption(values, form)
}
