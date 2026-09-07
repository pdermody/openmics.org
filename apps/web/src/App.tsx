import { useEffect, useState, type FormEvent } from 'react'
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
import { ApiError, api, friendlyApiErrorMessage } from './api/client'
import { beginSignIn } from './auth/session'
import { usePublicEvent, usePublicOpenMic, usePublicOpenMics, usePublicProfile, useUpcomingEvents, type Event, type OpenMic } from './features/publicReads'
import { useAccountContext } from './features/account'
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

function SignInButton() {
  const [message, setMessage] = useState('')
  return <>
    <button className="text-button" type="button" onClick={() => void beginSignIn().catch((error: Error) => setMessage(error.message))}>Sign in</button>
    {message && <span className="auth-note" role="status">{message}</span>}
  </>
}

function ProfileSwitcher() {
  const context = useAccountContext()
  if (!context.account.data || context.profiles.isPending || context.profiles.data?.items.length === 0) return null
  const profiles = context.profiles.data?.items ?? []
  const selected = profiles.find((profile) => profile.id === context.account.data?.current_profile_id)
  return <div className="profile-context-controls"><label className="profile-switcher">Profile
    <select value={context.account.data.current_profile_id ?? ''} onChange={(event) => context.currentProfile.mutate(event.target.value)} aria-label="Current profile">
      <option value="" disabled>Select profile</option>
      {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.profile_name} · {profile.profile_kind}</option>)}
    </select>
  </label>{selected && context.permissions.data?.permissions.includes('profiles:manage') && <span className="workspace-badge">Organizer workspace</span>}</div>
}

function EventCard({ event }: { event: Event }) {
  const date = new Date(event.starts_at)
  const day = Number.isNaN(date.getTime()) ? '--' : date.getDate()
  const month = Number.isNaN(date.getTime()) ? '---' : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
  const time = Number.isNaN(date.getTime()) ? 'Time to be announced' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return <article className="event-card">
    <div className="date-tile"><strong>{day}</strong><span>{month}</span></div>
    <div className="event-main"><div className="event-type">Open mic{event.capacity ? ` · ${event.capacity} spots` : ''}</div><h3><a className="card-link" href={`/events/${event.public_code}`}>{event.title}</a></h3><p className="event-meta"><Clock3 size={15} /> {time}</p><p className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</p><div className="tag-row">{(event.activities ?? []).slice(0, 3).map((activity) => <span key={activity}>{activity}</span>)}</div></div>
    <div className="event-action"><a className="primary-button" href={`/events/${event.public_code}/register`}>Register</a><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
  </article>
}

function SeriesCard({ openMic }: { openMic: OpenMic }) {
  const initials = openMic.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <article className="series-card">
    <div className="series-art"><span>{initials}</span></div>
    <div className="series-copy"><div className="event-type">Open mic series</div><h3><a className="card-link" href={`/open-mics/${openMic.id}`}>{openMic.name}</a></h3><p>{openMic.description ?? 'A welcoming room for singers, poets, and the curious.'}</p><div className="event-meta"><MapPin size={15} /> {openMic.city} · {openMic.status}</div></div>
    <div className="series-side"><button className="follow-button" type="button" disabled><Users size={16} /> Follow <small>soon</small></button><div className="social-row"><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div></div>
  </article>
}

function PublicDetail({ kind, id, theme, mode }: { kind: 'event' | 'open-mic' | 'profile'; id: string; theme: ThemeId; mode: ColorMode }) {
  const event = usePublicEvent(kind === 'event' ? id : undefined)
  const openMic = usePublicOpenMic(kind === 'open-mic' ? id : undefined)
  const profile = usePublicProfile(kind === 'profile' ? id : undefined)
  const loading = kind === 'event' ? event.isPending : kind === 'open-mic' ? openMic.isPending : profile.isPending
  const error = kind === 'event' ? event.isError : kind === 'open-mic' ? openMic.isError : profile.isError
  const title = event.data?.title ?? openMic.data?.name ?? profile.data?.profile_name
  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><ProfileSwitcher /><SignInButton /></header>
    <section className="detail-page">
      <a className="back-link" href="/">← Back to discovery</a>
      {loading && <ReadState message="Loading this room…" />}
      {error && <ReadState message={friendlyApiErrorMessage(kind === 'event' ? event.error : kind === 'open-mic' ? openMic.error : profile.error, 'This page could not be loaded. Please try again.')} retry={() => void (kind === 'event' ? event.refetch() : kind === 'open-mic' ? openMic.refetch() : profile.refetch())} />}
      {!loading && !error && title && <>
        <div className="eyebrow">{kind === 'event' ? 'Event detail' : kind === 'open-mic' ? 'Open mic series' : 'Public profile'}</div>
        <h1>{title}</h1>
        <p className="detail-lede">{event.data?.notes ?? openMic.data?.description ?? profile.data?.bio ?? 'A welcoming room for new voices.'}</p>
        <div className="detail-facts">
          {(event.data || openMic.data) && <span><MapPin size={16} /> {event.data?.venue_name ?? openMic.data?.venue_name}, {event.data?.city ?? openMic.data?.city}</span>}
          {event.data?.starts_at && <span><Clock3 size={16} /> {new Date(event.data.starts_at).toLocaleString()}</span>}
          {profile.data?.profile_kind && <span>{profile.data.profile_kind}</span>}
        </div>
        <div className="detail-actions">{kind === 'event' ? <a className="primary-button" href={`/events/${event.data?.public_code}/register`}>Register for this event</a> : <button className="primary-button" type="button">{kind === 'open-mic' ? 'See next event' : 'Follow profile'}</button>}<SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></div>
      </>}
    </section>
  </main>
}

function registrationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not complete your registration. Please try again.'
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  if (fieldErrors?.contact_email?.length) return 'Please enter a valid email address, such as you@example.com.'
  if (fieldErrors?.performer_name?.length) return 'Please enter the name you would like the organizer to call.'
  if (error.code === 'REGISTRATIONS_CLOSED') return 'Registration is closed for this event.'
  if (error.code === 'CAPACITY_EXCEEDED') return 'This event is full, but you can check back for cancellations.'
  if (error.code === 'DUPLICATE_REGISTRATION') return 'This email already has a registration for this event.'
  return 'Please check your details and try again.'
}

function RegistrationPage({ eventCode, theme, mode }: { eventCode: string; theme: ThemeId; mode: ColorMode }) {
  const event = usePublicEvent(eventCode)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profile) => profile.id === accountContext.account.data?.current_profile_id)
  const performerProfile = activeProfile?.profile_kind === 'performer' ? activeProfile : undefined
  const [performerName, setPerformerName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [performerCity, setPerformerCity] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [songNames, setSongNames] = useState('')
  const [mediaConsent, setMediaConsent] = useState(true)
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault()
    if (!performerProfile && !performerName.trim()) {
      setState('error')
      setMessage('Please enter the name you would like the organizer to call.')
      return
    }
    if (!performerProfile && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setState('error')
      setMessage('Please enter a valid email address, such as you@example.com.')
      return
    }
    setState('submitting')
    try {
      await api(`/events/${eventCode}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: performerProfile?.id,
          performer_name: performerProfile?.profile_name ?? performerName,
          contact_email: performerProfile ? undefined : contactEmail,
          performer_city: performerCity || undefined,
          contact_phone: contactPhone || undefined,
          song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
          media_consent: mediaConsent,
          submission_channel: 'organic',
          organizer_supervised: false,
        }),
      })
      setState('success')
      setMessage('Check your inbox to confirm your registration.')
    } catch (error) {
      setState('error')
      setMessage(registrationErrorMessage(error))
    }
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><ProfileSwitcher /><SignInButton /></header>
    <section className="registration-page">
      <a className="back-link" href={`/events/${eventCode}`}>← Back to event</a>
      {event.isPending && <ReadState message="Loading registration details…" />}
      {event.isError && <ReadState message="This event could not be loaded." retry={() => void event.refetch()} />}
      {event.data && <>
        <div className="eyebrow">Registration</div>
        <h1>Join {event.data.title}</h1>
        <p className="detail-lede">{event.data.venue_name}, {event.data.city}. We’ll email you a confirmation link before your name appears on the public roster.</p>
        {performerProfile && <div className="profile-context" role="status">Registering as <strong>{performerProfile.profile_name}</strong> · performer profile</div>}
        {state === 'success' ? <div className="success-panel" role="status"><strong>{message}</strong><p>Your place is pending email confirmation.</p></div> : <form className="registration-form" noValidate onSubmit={submit}>
          {!performerProfile && <><label>Performer name<input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label><label>Contact email<input required type="email" value={contactEmail} onChange={(input) => setContactEmail(input.target.value)} /></label></>}
          {!performerProfile && <><label>City <span className="field-hint">Optional</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label><label>Phone <span className="field-hint">Optional, for organizer contact</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label></>}
          <label>What will you perform? <span className="field-hint">Optional · separate songs with commas</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>I’m happy for photos or video of my performance to be shared by the organizer. You can change this later.</span></label>
          {state === 'error' && <p className="form-error" role="alert">{message}</p>}
          <button className="primary-button" type="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Sending…' : 'Register for this event'}</button>
        </form>}
      </>}
    </section>
  </main>
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
  const pathname = window.location.pathname
  const eventMatch = pathname.match(/^\/events\/([^/]+)$/)
  const registrationMatch = pathname.match(/^\/events\/([^/]+)\/register$/)
  const openMicMatch = pathname.match(/^\/open-mics\/([^/]+)$/)
  const profileMatch = pathname.match(/^\/profiles\/([^/]+)$/)

  useEffect(() => localStorage.setItem(THEME_STORAGE_KEY, theme), [theme])
  useEffect(() => localStorage.setItem(MODE_STORAGE_KEY, mode), [mode])

  if (eventMatch) return <PublicDetail kind="event" id={eventMatch[1]} theme={theme} mode={mode} />
  if (registrationMatch) return <RegistrationPage eventCode={registrationMatch[1]} theme={theme} mode={mode} />
  if (openMicMatch) return <PublicDetail kind="open-mic" id={openMicMatch[1]} theme={theme} mode={mode} />
  if (profileMatch) return <PublicDetail kind="profile" id={profileMatch[1]} theme={theme} mode={mode} />

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
        <ProfileSwitcher /><SignInButton />
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
        {upcomingEvents.isError && <ReadState message={friendlyApiErrorMessage(upcomingEvents.error, 'We could not load upcoming events. Please try again.')} retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.isSuccess && upcomingEvents.data.length === 0 && <ReadState message="No upcoming events yet. Check back soon." />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}
        <div className="section-heading series-heading"><div><span className="panel-label">Find your room</span><h2>Open mic series nearby</h2></div></div>
        {openMics.isPending && <ReadState message="Finding open mic series…" />}
        {openMics.isError && <ReadState message={friendlyApiErrorMessage(openMics.error, 'We could not load open mic series. Please try again.')} retry={() => void openMics.refetch()} />}
        {openMics.isSuccess && openMics.data.length === 0 && <ReadState message="No open mic series found yet." />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

      <footer className="footer"><span>Designed for voices, rooms, and the people who make them.</span><span>Theme reference · {activeTheme.name}</span></footer>
    </main>
  )
}

export default App
