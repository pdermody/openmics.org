import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import './App.css'
import { HomePage } from './views/HomePage'
import { ThemePage } from './views/ThemePage'
import { EventPage } from './views/EventPage'
import { OpenMicPage } from './views/OpenMicPage'
import { ProfilePage } from './views/ProfilePage'
import { RegistrationPage } from './views/RegistrationPage'
import { AuthPage } from './views/AuthPage'
import { OnboardingPage } from './views/OnboardingPage'
import { useAccountContext } from './features/account'
import { SiteFooter } from './views/shared'
import { i18n } from './i18n'
import { DEFAULT_THEME, isColorMode, isThemeId, MODE_STORAGE_KEY, systemColorMode, THEME_STORAGE_KEY, type ColorMode, type ThemeId } from './theme'

const ProfileEditor = lazy(() => import('./views/ProfileEditorPage').then((module) => ({ default: module.ProfileEditorPage })))
const OrganizerDashboard = lazy(() => import('./views/OrganizerDashboardPage').then((module) => ({ default: module.OrganizerDashboardPage })))
const OrganizerSeries = lazy(() => import('./views/OrganizerSeriesPage').then((module) => ({ default: module.OrganizerSeriesPage })))
const OrganizerEvents = lazy(() => import('./views/OrganizerEventsPage').then((module) => ({ default: module.OrganizerEventsPage })))
const OpenMicForm = lazy(() => import('./views/OpenMicFormPage').then((module) => ({ default: module.OpenMicFormPage })))
const EventForm = lazy(() => import('./views/EventFormPage').then((module) => ({ default: module.EventFormPage })))
const EventRoster = lazy(() => import('./views/EventRosterPage').then((module) => ({ default: module.EventRosterPage })))
const Kiosk = lazy(() => import('./views/KioskPage').then((module) => ({ default: module.KioskPage })))

function LazyView({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="app"><div className="route-loading" role="status">{i18n.t('loading')}</div></main>}>{children}</Suspense>
}

function RoutedView({ children, theme, mode }: { children: ReactNode; theme: ThemeId; mode: ColorMode }) {
  return <>{children}<SiteFooter theme={theme} mode={mode} /></>
}

function App() {
  const [theme, setTheme] = useState<ThemeId>(() => { const stored = localStorage.getItem(THEME_STORAGE_KEY); return isThemeId(stored) ? stored : DEFAULT_THEME })
  const [mode, setMode] = useState<ColorMode>(() => { const stored = localStorage.getItem(MODE_STORAGE_KEY); return isColorMode(stored) ? stored : systemColorMode() })
  const account = useAccountContext()
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
  const eventRosterMatch = pathname.match(/^\/dashboard\/series\/([^/]+)\/events\/([^/]+)\/roster$/)
  const eventKioskMatch = pathname.match(/^\/dashboard\/series\/([^/]+)\/events\/([^/]+)\/kiosk$/)
  const authMatch = pathname.match(/^\/auth\/(sign-in|sign-up|confirm-sign-up|forgot-password|reset-password)$/)
  const accountSecurityMatch = pathname === '/settings/security'

  useEffect(() => localStorage.setItem(THEME_STORAGE_KEY, theme), [theme])
  useEffect(() => localStorage.setItem(MODE_STORAGE_KEY, mode), [mode])

  const activeProfile = account.profiles.data?.items.find((profile) => profile.id === account.account.data?.current_profile_id)
  useEffect(() => {
    if (!activeProfile) return
    if (isThemeId(activeProfile.theme_name)) setTheme(activeProfile.theme_name)
    if (isColorMode(activeProfile.color_mode)) setMode(activeProfile.color_mode)
  }, [activeProfile?.id, activeProfile?.theme_name, activeProfile?.color_mode])

  // Every account must have at least one profile; gate all routes on a mandatory onboarding
  // step until the first profile is created (never gate while the profiles query is pending,
  // to avoid flashing onboarding for an account that already has profiles).
  const needsOnboarding = Boolean(account.account.data) && !account.profiles.isPending && account.profiles.data?.items.length === 0
  if (needsOnboarding) return <RoutedView theme={theme} mode={mode}><OnboardingPage theme={theme} mode={mode} setTheme={setTheme} setMode={setMode} /></RoutedView>

  if (themeMatch) return <RoutedView theme={theme} mode={mode}><ThemePage theme={theme} mode={mode} setTheme={setTheme} setMode={setMode} /></RoutedView>
  if (authMatch) return <AuthPage mode={authMatch[1] as 'sign-in' | 'sign-up' | 'confirm-sign-up' | 'forgot-password' | 'reset-password'} theme={theme} colorMode={mode} />
  if (accountSecurityMatch) return <AuthPage mode="change-password" theme={theme} colorMode={mode} />
  if (dashboardMatch) return <RoutedView theme={theme} mode={mode}><LazyView><OrganizerDashboard theme={theme} mode={mode} /></LazyView></RoutedView>
  if (seriesMatch) return <RoutedView theme={theme} mode={mode}><LazyView><OrganizerSeries theme={theme} mode={mode} /></LazyView></RoutedView>
  if (seriesNewMatch) return <RoutedView theme={theme} mode={mode}><LazyView><OpenMicForm theme={theme} mode={mode} /></LazyView></RoutedView>
  if (seriesEditMatch) return <RoutedView theme={theme} mode={mode}><LazyView><OpenMicForm seriesId={seriesEditMatch[1]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (eventNewMatch) return <RoutedView theme={theme} mode={mode}><LazyView><EventForm seriesId={eventNewMatch[1]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (eventEditMatch) return <RoutedView theme={theme} mode={mode}><LazyView><EventForm seriesId={eventEditMatch[1]} eventId={eventEditMatch[2]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (eventRosterMatch) return <RoutedView theme={theme} mode={mode}><LazyView><EventRoster seriesId={eventRosterMatch[1]} eventId={eventRosterMatch[2]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (eventKioskMatch) return <RoutedView theme={theme} mode={mode}><LazyView><Kiosk seriesId={eventKioskMatch[1]} eventId={eventKioskMatch[2]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (seriesEventsMatch) return <RoutedView theme={theme} mode={mode}><LazyView><OrganizerEvents seriesId={seriesEventsMatch[1]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (profileEditMatch) return <RoutedView theme={theme} mode={mode}><LazyView><ProfileEditor profileId={profileEditMatch[1]} theme={theme} mode={mode} /></LazyView></RoutedView>
  if (eventMatch) return <RoutedView theme={theme} mode={mode}><EventPage id={eventMatch[1]} theme={theme} mode={mode} /></RoutedView>
  if (registrationMatch) return <RoutedView theme={theme} mode={mode}><RegistrationPage eventCode={registrationMatch[1]} theme={theme} mode={mode} /></RoutedView>
  if (openMicMatch) return <RoutedView theme={theme} mode={mode}><OpenMicPage id={openMicMatch[1]} theme={theme} mode={mode} /></RoutedView>
  if (profileMatch) return <RoutedView theme={theme} mode={mode}><ProfilePage id={profileMatch[1]} theme={theme} mode={mode} /></RoutedView>
  return <RoutedView theme={theme} mode={mode}><HomePage theme={theme} mode={mode} /></RoutedView>
}

export default App
