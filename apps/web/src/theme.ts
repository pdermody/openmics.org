export type ThemeId = 'venue' | 'civic' | 'material' | 'radix' | 'solarized' | 'nord'
export type ColorMode = 'light' | 'dark'

export type ThemeDefinition = {
  id: ThemeId
  name: string
  source: string
  note: string
}

export const themes: ThemeDefinition[] = [
  { id: 'venue', name: 'House Lights', source: 'Original editorial system', note: 'Ink, brass, and paper warmth' },
  { id: 'civic', name: 'Day Set', source: 'Civic directory reference', note: 'Clear, welcoming, highly legible' },
  { id: 'material', name: 'Tonal Key', source: 'Material 3 reference', note: 'Balanced tonal surfaces and depth' },
  { id: 'radix', name: 'Soundcheck', source: 'Radix Colors reference', note: 'Crisp neutrals with precise accents' },
  { id: 'solarized', name: 'Soft Focus', source: 'Solarized reference', note: 'Quiet contrast for long sessions' },
  { id: 'nord', name: 'Blue Note', source: 'Nord reference', note: 'Cool, calm, and operational' },
]

export const DEFAULT_THEME: ThemeId = 'venue'
export const THEME_STORAGE_KEY = 'openmic:theme'
export const MODE_STORAGE_KEY = 'openmic:color-mode'

export function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value)
}

export function isColorMode(value: string | null): value is ColorMode {
  return value === 'light' || value === 'dark'
}

export function systemColorMode(): ColorMode {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
