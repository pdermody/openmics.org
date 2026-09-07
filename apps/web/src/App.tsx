import { useEffect, useState } from 'react'
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
import { usePublicOpenMics, useUpcomingEvents, type Event, type OpenMic } from './features/publicReads'
import {
  DEFAULT_THEME,
  isColorMode,
  isThemeId,
  MODE_STORAGE_KEY,
  systemColorMode,
  themes,
  THEME_STORAGE_KEY,
  type ColorMode,
  type ThemeId,
} from './theme'

function SocialButton({ label, icon }: { label: string; icon: 'heart' | 'message' }) {
  const Icon = icon === 'heart' ? Heart : MessageCircle
  return (
    <button className="social-button" type="button" disabled aria-label={`${label} coming soon`}>
      <Icon size={16} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  )
}

function ReadState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="read-state" role="status"><span>{message}</span>{retry && <button className="link-button" type="button" onClick={retry}>Try again</button>}</div>
}

function EventCard({ event }: { event: Event }) {
  const date = new Date(event.starts_at)
  const day = Number.isNaN(date.getTime()) ? '--' : date.getDate()
  const month = Number.isNaN(date.getTime()) ? '---' : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
  const time = Number.isNaN(date.getTime()) ? 'Time to be announced' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return <article className="event-card">
    <div className="date-tile"><strong>{day}</strong><span>{month}</span></div>
    <div className="event-main"><div className="event-type">Open mic{event.capacity ? ` · ${event.capacity} spots` : ''}</div><h3>{event.title}</h3><p className="event-meta"><Clock3 size={15} /> {time}</p><p className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</p><div className="tag-row">{(event.activities ?? []).slice(0, 3).map((activity) => <span key={activity}>{activity}</span>)}</div></div>
    <div className="event-action"><button className="primary-button" type="button">Register</button><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
  </article>
}

function SeriesCard({ openMic }: { openMic: OpenMic }) {
  const initials = openMic.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <article className="series-card">
    <div className="series-art"><span>{initials}</span></div>
    <div className="series-copy"><div className="event-type">Open mic series</div><h3>{openMic.name}</h3><p>{openMic.description ?? 'A welcoming room for singers, poets, and the curious.'}</p><div className="event-meta"><MapPin size={15} /> {openMic.city} · {openMic.status}</div></div>
    <div className="series-side"><button className="follow-button" type="button" disabled><Users size={16} /> Follow <small>soon</small></button><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
  </article>
}

function App() {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME
  })
  const [mode, setMode] = useState<ColorMode>(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    return isColorMode(stored) ? stored : systemColorMode()
  })
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]
  const upcomingEvents = useUpcomingEvents()
  const openMics = usePublicOpenMics()

  useEffect(() => localStorage.setItem(THEME_STORAGE_KEY, theme), [theme])
  useEffect(() => localStorage.setItem(MODE_STORAGE_KEY, mode), [mode])

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
        {upcomingEvents.isPending && <ReadState message="Finding upcoming rooms…" />}
        {upcomingEvents.isError && <ReadState message="We could not load upcoming events." retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.isSuccess && upcomingEvents.data.length === 0 && <ReadState message="No upcoming events yet. Check back soon." />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}
        <div className="section-heading series-heading"><div><span className="panel-label">Find your room</span><h2>Open mic series nearby</h2></div></div>
        {openMics.isPending && <ReadState message="Finding open mic series…" />}
        {openMics.isError && <ReadState message="We could not load open mic series." retry={() => void openMics.refetch()} />}
        {openMics.isSuccess && openMics.data.length === 0 && <ReadState message="No open mic series found yet." />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

      <footer className="footer"><span>Designed for voices, rooms, and the people who make them.</span><span>Theme reference · {activeTheme.name}</span></footer>
    </main>
  )
}

export default App
