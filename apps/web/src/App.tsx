import { useState } from 'react'
import {
  ChevronDown,
  Clock3,
  Heart,
  MapPin,
  MessageCircle,
  Moon,
  Palette,
  Share2,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'
import './App.css'

type ThemeId = 'venue' | 'civic' | 'material' | 'radix' | 'solarized' | 'nord'
type Mode = 'light' | 'dark'

const themes: Array<{ id: ThemeId; name: string; source: string; note: string }> = [
  { id: 'venue', name: 'Backstage', source: 'Original editorial system', note: 'Ink, brass, and paper warmth' },
  { id: 'civic', name: 'Daylight', source: 'Civic directory reference', note: 'Clear, welcoming, highly legible' },
  { id: 'material', name: 'Tonal', source: 'Material 3 reference', note: 'Balanced tonal surfaces and depth' },
  { id: 'radix', name: 'Signal', source: 'Radix Colors reference', note: 'Crisp neutrals with precise accents' },
  { id: 'solarized', name: 'Low-glare', source: 'Solarized reference', note: 'Quiet contrast for long sessions' },
  { id: 'nord', name: 'Fjord', source: 'Nord reference', note: 'Cool, calm, and operational' },
]

function SocialButton({ label, icon }: { label: string; icon: 'heart' | 'message' }) {
  const Icon = icon === 'heart' ? Heart : MessageCircle
  return (
    <button className="social-button" type="button" disabled aria-label={`${label} coming soon`}>
      <Icon size={16} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  )
}

function App() {
  const [theme, setTheme] = useState<ThemeId>('venue')
  const [mode, setMode] = useState<Mode>('light')
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Open Mic home">
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>open mic</span>
        </a>
        <nav className="topnav" aria-label="Primary navigation">
          <a className="active" href="#discover">Discover</a>
          <a href="#events">Events</a>
          <a href="#about">How it works</a>
        </nav>
        <button className="text-button" type="button">Sign in</button>
      </header>

      <section className="review-hero" id="discover">
        <div className="eyebrow"><Palette size={14} /> Theme review room</div>
        <div className="hero-grid">
          <div>
            <p className="kicker">A place for the next voice</p>
            <h1>Find your night.<br /><em>Take the mic.</em></h1>
            <p className="hero-copy">Browse welcoming open mics, see what is coming up, and find a room that feels like yours.</p>
            <div className="hero-actions">
              <button className="primary-button" type="button">Explore events <ChevronDown size={17} /></button>
              <button className="quiet-button" type="button">Share a series <Share2 size={16} /></button>
            </div>
          </div>
          <aside className="theme-panel" aria-label="Theme controls">
            <div className="panel-heading">
              <div><span className="panel-label">Current direction</span><strong>{activeTheme.name}</strong></div>
              <span className="source-pill">{activeTheme.source}</span>
            </div>
            <p>{activeTheme.note}</p>
            <div className="mode-switch" role="group" aria-label="Color mode">
              <button className={mode === 'light' ? 'selected' : ''} type="button" onClick={() => setMode('light')}><Sun size={15} /> Light</button>
              <button className={mode === 'dark' ? 'selected' : ''} type="button" onClick={() => setMode('dark')}><Moon size={15} /> Dark</button>
            </div>
          </aside>
        </div>
      </section>

      <section className="theme-strip" aria-label="Theme gallery">
        <div className="section-intro"><span className="panel-label">Six references</span><h2>Choose the room’s mood</h2></div>
        <div className="theme-grid">
          {themes.map((item) => (
            <button className={`theme-chip ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => setTheme(item.id)}>
              <span className="swatches" aria-hidden="true"><i /><i /><i /></span>
              <span><strong>{item.name}</strong><small>{item.source}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="content-grid" id="events">
        <div className="section-heading"><div><span className="panel-label">This week</span><h2>Rooms worth showing up for</h2></div><button className="link-button" type="button">View all events <span aria-hidden="true">↗</span></button></div>
        <article className="event-card">
          <div className="date-tile"><strong>14</strong><span>SEP</span></div>
          <div className="event-main"><div className="event-type">Open mic · 12 spots left</div><h3>Tuesday at The Lantern</h3><p className="event-meta"><Clock3 size={15} /> Tue, 14 Sep · 19:30</p><p className="event-meta"><MapPin size={15} /> The Lantern, Dublin 8</p><div className="tag-row"><span>Music</span><span>Poetry</span><span>All levels</span></div></div>
          <div className="event-action"><button className="primary-button" type="button">Register</button><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
        </article>
        <article className="series-card">
          <div className="series-art"><span>TL</span></div>
          <div className="series-copy"><div className="event-type">Open mic series</div><h3>The Lantern Sessions</h3><p>Small room, big-hearted nights for singers, poets, and the curious.</p><div className="event-meta"><MapPin size={15} /> Dublin 8 · Every Tuesday</div></div>
          <div className="series-side"><button className="follow-button" type="button" disabled><Users size={16} /> Follow <small>soon</small></button><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
        </article>
      </section>

      <footer className="footer"><span>Designed for voices, rooms, and the people who make them.</span><span>Theme reference · {activeTheme.name}</span></footer>
    </main>
  )
}

export default App
