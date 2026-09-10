import { Moon, Sun } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAccountContext } from '../features/account'
import { themes, type ColorMode, type ThemeId } from '../theme'
import type { ThemeProps } from './shared'
import { SiteHeader } from './shared'

export function ThemePage({ theme, mode, setTheme, setMode }: ThemeProps & { setTheme: (theme: ThemeId) => void; setMode: (mode: ColorMode) => void }) {
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]
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
        <a className="back-link" href="/">← Back to discovery</a>
        <div className="eyebrow">Appearance</div>
        <h1>Choose the room’s mood</h1>
        <p className="detail-lede">Give each of your profiles its own look and feel on openmics.org. Choose a theme and mood that helps you distinguish your profiles, whether you are presenting an organizer identity or stepping onto the stage.</p>
        <aside className="theme-panel theme-page-panel" aria-label="Color mode controls">
          <div className="panel-heading"><div><span className="panel-label">Current theme</span><strong>{activeTheme.name}</strong></div><span className="source-pill">{activeTheme.source}</span></div>
          <p>{activeTheme.note}</p>
          <div className="mode-switch" role="group" aria-label="Color mode">
            <button className={mode === 'light' ? 'selected' : ''} type="button" onClick={() => chooseMode('light')}><Sun size={15} /> Light</button>
            <button className={mode === 'dark' ? 'selected' : ''} type="button" onClick={() => chooseMode('dark')}><Moon size={15} /> Dark</button>
          </div>
        </aside>
        <div className="theme-grid theme-page-grid" aria-label="Theme gallery">
          {themes.map((item) => <button className={`theme-chip ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => chooseTheme(item.id)}><span className="swatches" aria-hidden="true">{item.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><span><strong>{item.name}</strong><small>{item.source}</small></span></button>)}
        </div>
      </section>
    </main>
  )
}
