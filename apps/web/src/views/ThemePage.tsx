import { Moon, Sun } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountContext } from '../features/account'
import { themes, type ColorMode, type ThemeId } from '../theme'
import type { ThemeProps } from './shared'
import { SiteHeader } from './shared'

export function ThemePage({ theme, mode, setTheme, setMode }: ThemeProps & { setTheme: (theme: ThemeId) => void; setMode: (mode: ColorMode) => void }) {
  const { t } = useTranslation()
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]
  const themeText = (id: ThemeId, field: 'name' | 'source' | 'note') => t(`themes.${id}.${field}`)
  const context = useAccountContext()
  const currentProfile = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const hasSyncedFromProfile = useRef(false)

  // On first load of a signed-in profile, prefer the profile's saved preferences over
  // whatever was already in localStorage (server is the source of truth once signed in).
  useEffect(() => {
    if (!currentProfile || hasSyncedFromProfile.current) return
    hasSyncedFromProfile.current = true
    if (currentProfile.theme_name && currentProfile.theme_name !== theme) setTheme(currentProfile.theme_name as ThemeId)
    if (currentProfile.color_mode && currentProfile.color_mode !== mode) setMode(currentProfile.color_mode as ColorMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProfile])

  function chooseTheme(next: ThemeId) {
    setTheme(next)
    if (currentProfile) context.updatePreferences.mutate({ id: currentProfile.id, theme_name: next })
  }

  function chooseMode(next: ColorMode) {
    setMode(next)
    if (currentProfile) context.updatePreferences.mutate({ id: currentProfile.id, color_mode: next })
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="theme-page">
        <a className="back-link" href="/">{t('backToDiscovery')}</a>
        <div className="eyebrow">{t('appearance')}</div>
        <h1>{t('chooseMood')}</h1>
        <p className="detail-lede">{t('themeIntro')}</p>
        <aside className="theme-panel theme-page-panel" aria-label={t('colorModeControls')}>
          <div className="panel-heading"><div><span className="panel-label">{t('currentTheme')}</span><strong>{themeText(activeTheme.id, 'name')}</strong></div><span className="source-pill">{themeText(activeTheme.id, 'source')}</span></div>
          <p>{themeText(activeTheme.id, 'note')}</p>
          <div className="mode-switch" role="group" aria-label={t('colorMode')}>
            <button className={mode === 'light' ? 'selected' : ''} type="button" onClick={() => chooseMode('light')}><Sun size={15} /> {t('light')}</button>
            <button className={mode === 'dark' ? 'selected' : ''} type="button" onClick={() => chooseMode('dark')}><Moon size={15} /> {t('dark')}</button>
          </div>
        </aside>
        <div className="theme-grid theme-page-grid" aria-label={t('themeGallery')}>
          {themes.map((item) => <button className={`theme-chip ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => chooseTheme(item.id)}><span className="swatches" aria-hidden="true">{item.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><span><strong>{themeText(item.id, 'name')}</strong><small>{themeText(item.id, 'source')}</small></span></button>)}
        </div>
      </section>
    </main>
  )
}
