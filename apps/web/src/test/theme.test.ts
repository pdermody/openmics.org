import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, isColorMode, isThemeId, themes } from '../theme'

describe('theme selection', () => {
  it('accepts every configured theme and rejects unknown values', () => {
    expect(themes).toHaveLength(12)
    expect(isThemeId(DEFAULT_THEME)).toBe(true)
    expect(isThemeId('missing-theme')).toBe(false)
  })

  it('accepts only supported color modes', () => {
    expect(isColorMode('light')).toBe(true)
    expect(isColorMode('dark')).toBe(true)
    expect(isColorMode('system')).toBe(false)
  })
})