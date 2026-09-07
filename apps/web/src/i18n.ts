import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      common: {
        translation: {
          appName: 'Open Mic',
          comingSoon: 'Coming soon',
        },
      },
    },
  },
})
