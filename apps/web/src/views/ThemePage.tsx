import { Moon, Sun } from 'lucide-react'
import { themes, type ColorMode, type ThemeId } from '../theme'
import type { ThemeProps } from './shared'
import { SiteHeader } from './shared'

export function ThemePage({ theme, mode, setTheme, setMode }: ThemeProps & { setTheme: (theme: ThemeId) => void; setMode: (mode: ColorMode) => void }) {
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]

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
            <button className={mode === 'light' ? 'selected' : ''} type="button" onClick={() => setMode('light')}><Sun size={15} /> Light</button>
            <button className={mode === 'dark' ? 'selected' : ''} type="button" onClick={() => setMode('dark')}><Moon size={15} /> Dark</button>
          </div>
        </aside>
        <div className="theme-grid theme-page-grid" aria-label="Theme gallery">
          {themes.map((item) => <button className={`theme-chip ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => setTheme(item.id)}><span className="swatches" aria-hidden="true">{item.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><span><strong>{item.name}</strong><small>{item.source}</small></span></button>)}
        </div>
      </section>
    </main>
  )
}
