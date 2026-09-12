import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

export const LANGUAGE_STORAGE_KEY = 'openmic:lang'
export const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]['code']

function supportedLanguage(value: string | null | undefined): SupportedLanguage | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase().replace('_', '-')
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : normalized === 'es' || normalized.startsWith('es-') ? 'es' : undefined
}

export function resolveInitialLanguage(storageValue?: string | null, browserLanguages?: readonly string[]): SupportedLanguage {
  const stored = supportedLanguage(storageValue)
  if (stored) return stored
  const languages = browserLanguages?.length ? browserLanguages : typeof navigator !== 'undefined' ? [...navigator.languages, navigator.language] : []
  for (const language of languages) {
    const resolved = supportedLanguage(language)
    if (resolved) return resolved
  }
  return 'en'
}

const initialLanguage = resolveInitialLanguage(typeof window !== 'undefined' ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : undefined)
const loadedLanguages = new Set<'en' | 'es'>()
const localeLoaders = {
  en: () => import('./locales/en/common.ts'),
  es: () => import('./locales/es/common.ts'),
} as const

export const i18n = i18next.createInstance()
const i18nInit = i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common'],
  interpolation: { escapeValue: false },
  resources: {},
})

async function loadLanguage(language: 'en' | 'es') {
  if (loadedLanguages.has(language)) return
  const module = await localeLoaders[language]()
  i18n.addResourceBundle(language, 'common', module.default, true, true)
  loadedLanguages.add(language)
}

export const i18nReady = i18nInit.then(async () => {
  await loadLanguage('en')
  if (initialLanguage === 'es') {
    await loadLanguage('es')
    await i18n.changeLanguage('es')
  }
})

export async function changeLanguage(language: 'en' | 'es') {
  await i18nReady
  await loadLanguage(language)
  await i18n.changeLanguage(language)
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  document.documentElement.lang = language
}

if (typeof document !== 'undefined') document.documentElement.lang = initialLanguage
