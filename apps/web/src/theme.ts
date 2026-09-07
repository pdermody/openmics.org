export type ThemeId = 'venue' | 'civic' | 'material' | 'radix' | 'solarized' | 'nord' | 'velvet' | 'electric' | 'cabaret' | 'marquee' | 'vinyl' | 'brass'
export type ColorMode = 'light' | 'dark'

export type ThemeDefinition = {
  id: ThemeId
  name: string
  source: string
  note: string
  swatches: [string, string, string]
}

export const themes: ThemeDefinition[] = [
  { id: 'venue', name: 'House Lights', source: 'Original editorial system', note: 'Ink, brass, and paper warmth', swatches: ['#b7492e', '#e8c0a7', '#dce5d6'] },
  { id: 'civic', name: 'Day Set', source: 'Civic directory reference', note: 'Clear, welcoming, highly legible', swatches: ['#176b66', '#a9d4ca', '#dcebdc'] },
  { id: 'material', name: 'Tonal Key', source: 'Material 3 reference', note: 'Balanced tonal surfaces and depth', swatches: ['#6d4c85', '#c9b2dd', '#e3dbea'] },
  { id: 'radix', name: 'Soundcheck', source: 'Radix Colors reference', note: 'Crisp neutrals with precise accents', swatches: ['#2563a8', '#a9caeb', '#dbe9f7'] },
  { id: 'solarized', name: 'Soft Focus', source: 'Solarized reference', note: 'Quiet contrast for long sessions', swatches: ['#b35b20', '#e8c59e', '#e6edd1'] },
  { id: 'nord', name: 'Blue Note', source: 'Nord reference', note: 'Cool, calm, and operational', swatches: ['#437b86', '#b9d0d4', '#d7e5e3'] },
  { id: 'velvet', name: 'Velvet Rope', source: 'Art Deco / jewel-tone reference', note: 'Plum velvet, champagne, and stage-door drama', swatches: ['#852d63', '#e0b77c', '#ead8de'] },
  { id: 'electric', name: 'Electric Set', source: 'Neon night reference', note: 'Cobalt ink with live-wire citrus accents', swatches: ['#2451c4', '#f1c84b', '#d9f0dd'] },
  { id: 'cabaret', name: 'Cabaret', source: 'Bauhaus / theatrical reference', note: 'Black, vermilion, and cream with sharp geometry', swatches: ['#c4372d', '#e4a43d', '#dedcc8'] },
  { id: 'marquee', name: 'Marquee', source: 'Cinema poster reference', note: 'Royal blue, coral light, and polished gold', swatches: ['#d85455', '#eabf52', '#dce3f2'] },
  { id: 'vinyl', name: 'First Pressing', source: 'Record sleeve reference', note: 'Terracotta, sea-glass, and saturated print color', swatches: ['#bf583c', '#70a7a0', '#e5ddc7'] },
  { id: 'brass', name: 'Brass Section', source: 'Jazz club / brass reference', note: 'Burnished gold, bottle green, and nocturne ink', swatches: ['#98651e', '#d3a94b', '#d7e2d0'] },
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
