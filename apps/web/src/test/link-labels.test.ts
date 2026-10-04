import { describe, expect, it } from 'vitest'
import english from '../locales/en/common'
import spanish from '../locales/es/common'

const linkKeys = [
  'backToDashboard', 'backToDiscovery', 'backToEvent', 'backToEvents',
  'backToNamedSeries', 'backToProfile', 'backToSeries',
  'mediaBackToRoster', 'mediaBackToSeries', 'mediaGalleryViewPublic',
] as const

describe('navigation link labels', () => {
  it.each([['English', english], ['Spanish', spanish]] as const)('omits decorative arrows in %s', (_language, translations) => {
    for (const key of linkKeys) {
      expect(translations[key]).not.toMatch(/[←→↗↖⇒➜⟶⟵]/)
      expect(translations[key].trim()).not.toBe('')
    }
    expect(translations.backToNamedSeries).toContain('{{series}}')
  })
})
