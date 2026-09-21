import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, RouterProvider } from '@tanstack/react-router'
import './App.css'
import { HomePage } from './views/HomePage'
import { ThemePage } from './views/ThemePage'
import { EventPage } from './views/EventPage'
import { OpenMicPage } from './views/OpenMicPage'
import { ProfilePage } from './views/ProfilePage'
import { RegistrationPage } from './views/RegistrationPage'
import { DurableRegistrationPage } from './views/DurableRegistrationPage'
import { AuthPage } from './views/AuthPage'
import { OnboardingPage } from './views/OnboardingPage'
import { useAccountContext } from './features/account'
import { SiteFooter } from './views/shared'
import { i18n } from './i18n'
import { DEFAULT_THEME, isColorMode, isThemeId, MODE_STORAGE_KEY, systemColorMode, THEME_STORAGE_KEY, type ColorMode, type ThemeId } from './theme'

const ProfileEditor = lazyRouteComponent(() => import('./views/ProfileEditorPage'), 'ProfileEditorPage')
const OrganizerDashboard = lazyRouteComponent(() => import('./views/OrganizerDashboardPage'), 'OrganizerDashboardPage')
const OrganizerEvents = lazyRouteComponent(() => import('./views/OrganizerEventsPage'), 'OrganizerEventsPage')
const OpenMicForm = lazyRouteComponent(() => import('./views/OpenMicFormPage'), 'OpenMicFormPage')
const EventForm = lazyRouteComponent(() => import('./views/EventFormPage'), 'EventFormPage')
const EventRoster = lazyRouteComponent(() => import('./views/EventRosterPage'), 'EventRosterPage')
const Kiosk = lazyRouteComponent(() => import('./views/KioskPage'), 'KioskPage')
const ClaimableRegistrations = lazyRouteComponent(() => import('./views/ClaimableRegistrationsPage'), 'ClaimableRegistrationsPage')

const AUTH_MODES = ['sign-in', 'sign-up', 'confirm-sign-up', 'forgot-password', 'reset-password'] as const
type AuthMode = (typeof AUTH_MODES)[number]
function isAuthMode(value: string): value is AuthMode {
  return (AUTH_MODES as readonly string[]).includes(value)
}

function LazyView({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="app"><div className="route-loading" role="status">{i18n.t('loading')}</div></main>}>{children}</Suspense>
}

// TanStack Router only detects a route as preloadable (for `defaultPreload: 'intent'`) if its
// `component` itself carries a `.preload` — attach the underlying lazyRouteComponent's `.preload`
// to each route's wrapper so hovering a <Link> actually prefetches that view's chunk.
function withPreload<T extends (...args: never[]) => unknown>(component: T, source: { preload?: () => Promise<unknown> | undefined }): T {
  return Object.assign(component, { preload: source.preload })
}

function RoutedView({ children, theme, mode }: { children: ReactNode; theme: ThemeId; mode: ColorMode }) {
  return <>{children}<SiteFooter theme={theme} mode={mode} /></>
}

// Theme/mode live on the root route (so every route can read them) rather than being threaded
// through the router's own context API, since every view already takes them as plain props —
// this keeps that existing prop-based contract unchanged for every page component.
type ThemeModeState = { theme: ThemeId; mode: ColorMode; setTheme: (theme: ThemeId) => void; setMode: (mode: ColorMode) => void }
const ThemeModeContext = createContext<ThemeModeState | null>(null)
function useThemeMode(): ThemeModeState {
  const value = useContext(ThemeModeContext)
  if (!value) throw new Error('useThemeMode must be used within the router root layout')
  return value
}

function HomeRoute() {
  const { theme, mode } = useThemeMode()
  return <RoutedView theme={theme} mode={mode}><HomePage theme={theme} mode={mode} /></RoutedView>
}

function RootLayout() {
  const [theme, setTheme] = useState<ThemeId>(() => { const stored = localStorage.getItem(THEME_STORAGE_KEY); return isThemeId(stored) ? stored : DEFAULT_THEME })
  const [mode, setMode] = useState<ColorMode>(() => { const stored = localStorage.getItem(MODE_STORAGE_KEY); return isColorMode(stored) ? stored : systemColorMode() })
  const account = useAccountContext()

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

  return <ThemeModeContext.Provider value={{ theme, mode, setTheme, setMode }}><Outlet /></ThemeModeContext.Provider>
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: HomeRoute })

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeRoute })

const themeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/theme',
  component: () => {
    const { theme, mode, setTheme, setMode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><ThemePage theme={theme} mode={mode} setTheme={setTheme} setMode={setMode} /></RoutedView>
  },
})

const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/security',
  component: () => {
    const { theme, mode } = useThemeMode()
    return <AuthPage mode="change-password" theme={theme} colorMode={mode} />
  },
})

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/$mode',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { mode: authMode } = authRoute.useParams()
    if (!isAuthMode(authMode)) return <HomeRoute />
    return <AuthPage mode={authMode} theme={theme} colorMode={mode} />
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><LazyView><OrganizerDashboard theme={theme} mode={mode} /></LazyView></RoutedView>
  }, OrganizerDashboard),
})

const claimableRegistrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/claim-registrations',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><LazyView><ClaimableRegistrations theme={theme} mode={mode} /></LazyView></RoutedView>
  }, ClaimableRegistrations),
})

const seriesNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/new',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><LazyView><OpenMicForm theme={theme} mode={mode} /></LazyView></RoutedView>
  }, OpenMicForm),
})

const seriesEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/edit',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId } = seriesEditRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><OpenMicForm seriesId={seriesId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, OpenMicForm),
})

const seriesEventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId } = seriesEventsRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><OrganizerEvents seriesId={seriesId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, OrganizerEvents),
})

const eventNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/events/new',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId } = eventNewRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><EventForm seriesId={seriesId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, EventForm),
})

const eventEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/events/$eventId/edit',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId, eventId } = eventEditRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><EventForm seriesId={seriesId} eventId={eventId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, EventForm),
})

const eventRosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/events/$eventId/roster',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId, eventId } = eventRosterRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><EventRoster seriesId={seriesId} eventId={eventId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, EventRoster),
})

// No SiteFooter here: its site-wide nav links (home, appearance settings) would let someone
// slip out of the locked kiosk without going through the PIN-gated exit flow.
const eventKioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/events/$eventId/kiosk',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId, eventId } = eventKioskRoute.useParams()
    return <LazyView><Kiosk seriesId={seriesId} eventId={eventId} theme={theme} mode={mode} /></LazyView>
  }, Kiosk),
})

const profileEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles/$profileId/edit',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { profileId } = profileEditRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><ProfileEditor profileId={profileId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, ProfileEditor),
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles/$profileId',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { profileId } = profileRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><ProfilePage id={profileId} theme={theme} mode={mode} /></RoutedView>
  },
})

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { eventId } = eventDetailRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><EventPage id={eventId} theme={theme} mode={mode} /></RoutedView>
  },
})

const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/register',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { eventId } = registrationRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><RegistrationPage eventCode={eventId} theme={theme} mode={mode} /></RoutedView>
  },
})

const openMicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/open-mics/$openMicId',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { openMicId } = openMicRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><OpenMicPage id={openMicId} theme={theme} mode={mode} /></RoutedView>
  },
})

const openMicRegistrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/open-mics/$openMicId/register',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { openMicId } = openMicRegistrationRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><DurableRegistrationPage openMicId={openMicId} theme={theme} mode={mode} /></RoutedView>
  },
})

// Vanity handle registration: "/@handle/register" — the leading "@" is a literal prefix on the
// same segment as the `handle` param (TanStack's `prefix{$param}suffix` segment syntax).
const vanityRegistrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/@{$handle}/register',
  component: () => {
    const { theme, mode } = useThemeMode()
    const { handle } = vanityRegistrationRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><DurableRegistrationPage openMicId={handle} theme={theme} mode={mode} /></RoutedView>
  },
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  themeRoute,
  securityRoute,
  authRoute,
  dashboardRoute,
  claimableRegistrationsRoute,
  seriesNewRoute,
  seriesEditRoute,
  seriesEventsRoute,
  eventNewRoute,
  eventEditRoute,
  eventRosterRoute,
  eventKioskRoute,
  profileEditRoute,
  profileRoute,
  eventDetailRoute,
  registrationRoute,
  openMicRoute,
  openMicRegistrationRoute,
  vanityRegistrationRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

// Registers this app's concrete route tree as the default for every `<Link>`/`useNavigate()`
// call, so `to`/`params` are checked against real routes instead of falling back to `string`.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App() {
  return <RouterProvider router={router} />
}

export default App
