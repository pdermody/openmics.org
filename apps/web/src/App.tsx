import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import './App.css'
import { HomePage } from './views/HomePage'
import { ThemePage } from './views/ThemePage'
import { EventPage } from './views/EventPage'
import { OpenMicPage } from './views/OpenMicPage'
import { ProfilePage } from './views/ProfilePage'
import { RegistrationPage } from './views/RegistrationPage'
import { DEFAULT_THEME, isColorMode, isThemeId, MODE_STORAGE_KEY, systemColorMode, THEME_STORAGE_KEY, type ColorMode, type ThemeId } from './theme'

const ProfileEditor = lazy(() => import('./views/ProfileEditorPage').then((module) => ({ default: module.ProfileEditorPage })))
const OrganizerDashboard = lazy(() => import('./views/OrganizerDashboardPage').then((module) => ({ default: module.OrganizerDashboardPage })))
const OrganizerSeries = lazy(() => import('./views/OrganizerSeriesPage').then((module) => ({ default: module.OrganizerSeriesPage })))
const OrganizerEvents = lazy(() => import('./views/OrganizerEventsPage').then((module) => ({ default: module.OrganizerEventsPage })))
const OpenMicForm = lazy(() => import('./views/OpenMicFormPage').then((module) => ({ default: module.OpenMicFormPage })))
const EventForm = lazy(() => import('./views/EventFormPage').then((module) => ({ default: module.EventFormPage })))

function LazyView({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="app"><div className="route-loading" role="status">Loading workspace…</div></main>}>{children}</Suspense>
}

function App() {
  const [theme, setTheme] = useState<ThemeId>(() => { const stored = localStorage.getItem(THEME_STORAGE_KEY); return isThemeId(stored) ? stored : DEFAULT_THEME })
  const [mode, setMode] = useState<ColorMode>(() => { const stored = localStorage.getItem(MODE_STORAGE_KEY); return isColorMode(stored) ? stored : systemColorMode() })
  const pathname = window.location.pathname
  const eventMatch = pathname.match(/^\/events\/([^/]+)$/)
  const registrationMatch = pathname.match(/^\/events\/([^/]+)\/register$/)
  const openMicMatch = pathname.match(/^\/open-mics\/([^/]+)$/)
  const profileMatch = pathname.match(/^\/profiles\/([^/]+)$/)
  const profileEditMatch = pathname.match(/^\/profiles\/([^/]+)\/edit$/)
  const themeMatch = pathname === '/settings/theme'
  const dashboardMatch = pathname === '/dashboard'
  const seriesMatch = pathname === '/dashboard/series'
  const seriesNewMatch = pathname === '/dashboard/series/new'
  const seriesEditMatch = pathname.match(/^\/dashboard\/series\/([^/]+)\/edit$/)
  const seriesEventsMatch = pathname.match(/^\/dashboard\/series\/([^/]+)$/)
  const eventNewMatch = pathname.match(/^\/dashboard\/series\/([^/]+)\/events\/new$/)
  const eventEditMatch = pathname.match(/^\/dashboard\/series\/([^/]+)\/events\/([^/]+)\/edit$/)

  useEffect(() => localStorage.setItem(THEME_STORAGE_KEY, theme), [theme])
  useEffect(() => localStorage.setItem(MODE_STORAGE_KEY, mode), [mode])

  if (themeMatch) return <ThemePage theme={theme} mode={mode} setTheme={setTheme} setMode={setMode} />
  if (dashboardMatch) return <LazyView><OrganizerDashboard theme={theme} mode={mode} /></LazyView>
  if (seriesMatch) return <LazyView><OrganizerSeries theme={theme} mode={mode} /></LazyView>
  if (seriesNewMatch) return <LazyView><OpenMicForm theme={theme} mode={mode} /></LazyView>
  if (seriesEditMatch) return <LazyView><OpenMicForm seriesId={seriesEditMatch[1]} theme={theme} mode={mode} /></LazyView>
  if (eventNewMatch) return <LazyView><EventForm seriesId={eventNewMatch[1]} theme={theme} mode={mode} /></LazyView>
  if (eventEditMatch) return <LazyView><EventForm seriesId={eventEditMatch[1]} eventId={eventEditMatch[2]} theme={theme} mode={mode} /></LazyView>
  if (seriesEventsMatch) return <LazyView><OrganizerEvents seriesId={seriesEventsMatch[1]} theme={theme} mode={mode} /></LazyView>
  if (profileEditMatch) return <LazyView><ProfileEditor profileId={profileEditMatch[1]} theme={theme} mode={mode} /></LazyView>
  if (eventMatch) return <EventPage id={eventMatch[1]} theme={theme} mode={mode} />
  if (registrationMatch) return <RegistrationPage eventCode={registrationMatch[1]} theme={theme} mode={mode} />
  if (openMicMatch) return <OpenMicPage id={openMicMatch[1]} theme={theme} mode={mode} />
  if (profileMatch) return <ProfilePage id={profileMatch[1]} theme={theme} mode={mode} />
  return <HomePage theme={theme} mode={mode} />
}

export default App
