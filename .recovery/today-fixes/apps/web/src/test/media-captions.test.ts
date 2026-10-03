import { describe, expect, it } from 'vitest'

import { availableCaptionTokens, defaultCaption, resolveCaption, substituteCaption } from '../features/media-captions'

// MIRROR SUITE: pinned to apps/api/tests/unit/media-captions.test.ts — the token
// mechanics must be behavior-identical between the server copy (OG/alt text) and this
// web copy (editor preview, gallery captions). Keep both suites in lockstep.
describe('substituteCaption (mirrors the API token mechanics)', () => {
  const values = { performerName: 'Amy Hart', performerCity: 'Dublin', eventName: 'Friday Stage', eventDate: '15 Dec 2026' }

  it('substitutes all four tokens', () => {
    expect(substituteCaption('{performer_name} from {performer_city} at {event_name} on {event_date}', values)).toBe(
      'Amy Hart from Dublin at Friday Stage on 15 Dec 2026',
    )
  })

  it('drops missing tokens and trims surrounding whitespace, dashes, and punctuation', () => {
    expect(substituteCaption('{performer_name} — {performer_city}', { performerName: 'Amy Hart' })).toBe('Amy Hart')
    expect(substituteCaption('{performer_name} · {event_name}', { performerName: 'Amy Hart' })).toBe('Amy Hart')
    expect(substituteCaption('{event_date}: {performer_name}', { performerName: 'Amy Hart' })).toBe('Amy Hart')
    expect(substituteCaption('at {event_name}', {})).toBe('at')
  })

  it('collapses orphaned separator runs left by dropped tokens', () => {
    expect(substituteCaption('{performer_name} — {performer_city} — {event_name}', { performerName: 'Amy' })).toBe('Amy')
    expect(substituteCaption('{performer_city}, {event_name}', { performerName: 'Amy' })).toBe('')
  })

  it('leaves unknown tokens untouched so typos stay visible', () => {
    expect(substituteCaption('{song_title} by {performer_name}', { performerName: 'Amy Hart' })).toBe('{song_title} by Amy Hart')
  })

  it('trims values and collapses whitespace runs', () => {
    expect(substituteCaption('{performer_name}   live', { performerName: '  Amy  ' })).toBe('Amy live')
  })
})

describe('defaultCaption (localized defaults, design §7.2/§7.3)', () => {
  it('short form: performer + city, or bare performer without a city', () => {
    expect(defaultCaption({ performerName: 'Amy Hart', performerCity: 'Dublin' }, 'short')).toBe('Amy Hart from Dublin')
    expect(defaultCaption({ performerName: 'Amy Hart' }, 'short')).toBe('Amy Hart')
  })

  it('long form composes event and date', () => {
    expect(defaultCaption({ performerName: 'Amy Hart', performerCity: 'Dublin', eventName: 'Friday Stage', eventDate: '15 Dec 2026' }, 'long')).toBe(
      'Amy Hart from Dublin at Friday Stage on 15 Dec 2026',
    )
    expect(defaultCaption({ performerName: 'Amy Hart', eventName: 'Friday Stage' }, 'long')).toBe('Amy Hart at Friday Stage')
    expect(defaultCaption({ performerName: 'Amy Hart', eventDate: '15 Dec 2026' }, 'long')).toBe('Amy Hart on 15 Dec 2026')
  })

  it('free-standing media has no default caption', () => {
    expect(defaultCaption({ eventName: 'Friday Stage' }, 'long')).toBe('')
    expect(defaultCaption({}, 'short')).toBe('')
  })

  it('localizes (Spanish)', async () => {
    const { changeLanguage } = await import('../i18n')
    await changeLanguage('es')
    expect(defaultCaption({ performerName: 'Amy Hart', performerCity: 'Dublin' }, 'short')).toBe('Amy Hart de Dublin')
    expect(defaultCaption({ performerName: 'Amy Hart', eventName: 'Escenario Viernes' }, 'long')).toBe('Amy Hart en Escenario Viernes')
    await changeLanguage('en')
  })
})

describe('resolveCaption / availableCaptionTokens', () => {
  it('organizer captions win over defaults', () => {
    expect(resolveCaption('Great night with {performer_name}', { performerName: 'Amy Hart' }, 'short')).toBe('Great night with Amy Hart')
    expect(resolveCaption(null, { performerName: 'Amy Hart', performerCity: 'Dublin' }, 'short')).toBe('Amy Hart from Dublin')
  })

  it('lists fewer tokens for free-standing and series-scope media', () => {
    expect(availableCaptionTokens({ attributed: true, eventScoped: true })).toEqual(['performer_name', 'performer_city', 'event_name', 'event_date'])
    expect(availableCaptionTokens({ attributed: false, eventScoped: true })).toEqual(['event_name', 'event_date'])
    expect(availableCaptionTokens({ attributed: false, eventScoped: false })).toEqual([])
  })
})
