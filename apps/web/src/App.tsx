import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'
import { createBrowserHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, RouterProvider, useLocation, useNavigate } from '@tanstack/react-router'
import './App.css'
import { HomePage } from './views/HomePage'
import { discoverySearchSchema } from './features/discoverySearch'
import { gallerySearchSchema } from './features/gallerySearch'
import { ThemePage } from './views/ThemePage'
import { EventPage } from './views/EventPage'
import { OpenMicPage } from './views/OpenMicPage'
import { ProfilePage } from './views/ProfilePage'
import { RegistrationPage } from './views/RegistrationPage'
import { DurableRegistrationPage } from './views/DurableRegistrationPage'
import { AuthPage } from './views/AuthPage'
import { OnboardingPage } from './views/OnboardingPage'
import { useAccountContext } from './features/account'
import { useOrganizerProfile } from './features/organizer'
import { usePublicEvent, useResolveHandle } from './features/publicReads'
import { consumePendingSignInRedirect } from './auth/session'
import { ReadState, SiteFooter } from './views/shared'
import { i18n } from './i18n'
import { DEFAULT_THEME, isColorMode, isThemeId, MODE_STORAGE_KEY, systemColorMode, THEME_STORAGE_KEY, type ColorMode, type ThemeId } from './theme'

const AccountSettings = lazyRouteComponent(() => import('./views/AccountPage'), 'AccountPage')
const DiscoveryResults = lazyRouteComponent(() => import('./views/DiscoveryPage'), 'DiscoveryPage')
const ProfileEditor = lazyRouteComponent(() => import('./views/ProfileEditorPage'), 'ProfileEditorPage')
const OrganizerDashboard = lazyRouteComponent(() => import('./views/OrganizerDashboardPage'), 'OrganizerDashboardPage')
const OrganizerEvents = lazyRouteComponent(() => import('./views/OrganizerEventsPage'), 'OrganizerEventsPage')
const OpenMicForm = lazyRouteComponent(() => import('./views/OpenMicFormPage'), 'OpenMicFormPage')
const EventForm = lazyRouteComponent(() => import('./views/EventFormPage'), 'EventFormPage')
const EventRoster = lazyRouteComponent(() => import('./views/EventRosterPage'), 'EventRosterPage')
const Kiosk = lazyRouteComponent(() => import('./views/KioskPage'), 'KioskPage')
const ClaimableRegistrations = lazyRouteComponent(() => import('./views/ClaimableRegistrationsPage'), 'ClaimableRegistrationsPage')
const ProfileManagement = lazyRouteComponent(() => import('./views/ProfileManagementPage'), 'ProfileManagementPage')
const MediaDeepLink = lazyRouteComponent(() => import('./views/MediaDeepLinkPage'), 'MediaDeepLinkPage')
const EventMediaManage = lazyRouteComponent(() => import('./views/EventMediaManagePage'), 'EventMediaManagePage')
const SeriesMediaManage = lazyRouteComponent(() => import('./views/SeriesMediaManagePage'), 'SeriesMediaManagePage')
const PublicDetails = lazyRouteComponent(() => import('./views/PublicDetailsPage'), 'PublicDetailsPage')

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

// Gallery query params shared by the event / series / profile detail routes: `media`
// (deep-link anchor opened in the lightbox), `mediaUnavailable` (stale deep-link toast),
// plus the type filter and sort which persist via URL + localStorage (design §11.1).

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

// Whether the dashboard should replace Home for an organizer profile right after this browser
// just completed a sign-in (see `markPendingSignInRedirect` in auth/session.ts) — a later,
// deliberate visit to '/' (e.g. via the brand link, or an ordinary page reload of an already
// signed-in session) is never redirected away again.
function HomeRoute() {
  const { theme, mode } = useThemeMode()
  const { isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const navigate = useNavigate()
  const [isPostSignIn] = useState(() => consumePendingSignInRedirect())

  useEffect(() => {
    if (!isPostSignIn || isOrganizerPending) return
    if (isOrganizer) void navigate({ to: '/dashboard', replace: true })
  }, [isPostSignIn, isOrganizerPending, isOrganizer, navigate])

  if (isPostSignIn && isOrganizerPending) {
    return <RoutedView theme={theme} mode={mode}><main className="app" data-theme={theme} data-mode={mode}><ReadState message={i18n.t('loading')} /></main></RoutedView>
  }
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

const discoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discover',
  validateSearch: (search) => discoverySearchSchema.parse(search),
  component: withPreload(function DiscoveryRouteView() {
    const { theme, mode } = useThemeMode()
    const search = discoveryRoute.useSearch()
    return <RoutedView theme={theme} mode={mode}><LazyView><DiscoveryResults theme={theme} mode={mode} {...search} /></LazyView></RoutedView>
  }, DiscoveryResults),
})

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

const profileManagementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles/manage',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><LazyView><ProfileManagement theme={theme} mode={mode} /></LazyView></RoutedView>
  }, ProfileManagement),
})

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    return <RoutedView theme={theme} mode={mode}><LazyView><AccountSettings theme={theme} mode={mode} /></LazyView></RoutedView>
  }, AccountSettings),
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
  validateSearch: (search: Record<string, unknown>) => ({
    sourceEventId: typeof search.sourceEventId === 'string' && search.sourceEventId.length <= 100 ? search.sourceEventId : undefined,
    copySchedule: search.copySchedule === true || search.copySchedule === 'true'
      || search.copyDateOnly === true || search.copyDateOnly === 'true',
  }),
  component: withPreload(() => {
    const { theme, mode } = useThemeMode()
    const { seriesId } = eventNewRoute.useParams()
    const { sourceEventId, copySchedule } = eventNewRoute.useSearch()
    return <RoutedView theme={theme} mode={mode}><LazyView><EventForm seriesId={seriesId} sourceEventId={sourceEventId} copySchedule={copySchedule} theme={theme} mode={mode} /></LazyView></RoutedView>
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

const eventMediaManageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/events/$eventId/media',
  component: withPreload(function EventMediaManageRoute() {
    const { theme, mode } = useThemeMode()
    const { seriesId, eventId } = eventMediaManageRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><EventMediaManage seriesId={seriesId} eventId={eventId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, EventMediaManage),
})

const seriesMediaManageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard/series/$seriesId/media',
  component: withPreload(function SeriesMediaManageRoute() {
    const { theme, mode } = useThemeMode()
    const { seriesId } = seriesMediaManageRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><SeriesMediaManage seriesId={seriesId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, SeriesMediaManage),
})

const mediaDeepLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/media/$mediaId',
  component: withPreload(function MediaDeepLinkRoute() {
    const { theme, mode } = useThemeMode()
    const { mediaId } = mediaDeepLinkRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><LazyView><MediaDeepLink mediaId={mediaId} theme={theme} mode={mode} /></LazyView></RoutedView>
  }, MediaDeepLink),
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
  validateSearch: gallerySearchSchema,
  component: () => {
    const { theme, mode } = useThemeMode()
    const { profileId } = profileRoute.useParams()
    return <RoutedView theme={theme} mode={mode}><ProfilePage id={profileId} theme={theme} mode={mode} /></RoutedView>
  },
})

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  validateSearch: gallerySearchSchema,
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
  validateSearch: gallerySearchSchema,
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

// Vanity handle series detail: "/@handle" — open-mics only for now; profiles get their own
// vanity route once a public profile page exists. Resolves through the handles table (the
// source of truth for handle -> entity mapping) rather than an entity table's own handle match,
// so this keeps working once profile handles are wired up too.
const vanityOpenMicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/@{$handle}',
  validateSearch: gallerySearchSchema,
  component: () => {
    const { theme, mode } = useThemeMode()
    const { handle } = vanityOpenMicRoute.useParams()
    const resolved = useResolveHandle(handle)
    if (resolved.isPending) return <RoutedView theme={theme} mode={mode}><main className="app" data-theme={theme} data-mode={mode}><ReadState message={i18n.t('loading')} /></main></RoutedView>
    if (resolved.isError || resolved.data?.type !== 'open_mic') return <HomeRoute />
    return <RoutedView theme={theme} mode={mode}><OpenMicPage id={resolved.data.id} theme={theme} mode={mode} /></RoutedView>
  },
})

function PublicDetailsRouteView({ kind, id, handle }: { kind: 'event' | 'open-mic'; id?: string; handle?: string }) {
  const { theme, mode } = useThemeMode()
  const resolved = useResolveHandle(handle)
  if (handle && resolved.isPending) return <ReadState message={i18n.t('loading')} />
  if (handle && (resolved.isError || resolved.data?.type !== 'open_mic')) return <ReadState message={i18n.t('publicDetailsUnavailable')} />
  return <RoutedView theme={theme} mode={mode}><LazyView><PublicDetails kind={kind} id={id ?? resolved.data!.id}
    expectedSeriesId={handle ? resolved.data?.id : undefined} theme={theme} mode={mode} /></LazyView></RoutedView>
}

const seriesDetailsRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/open-mics/$openMicId/details',
  component: () => <PublicDetailsRouteView kind="open-mic" id={seriesDetailsRoute.useParams().openMicId} />,
})
const eventDetailsRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/events/$eventId/details',
  component: () => <PublicDetailsRouteView kind="event" id={eventDetailsRoute.useParams().eventId} />,
})
const vanitySeriesDetailsRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/@{$handle}/details',
  component: () => <PublicDetailsRouteView kind="open-mic" handle={vanitySeriesDetailsRoute.useParams().handle} />,
})
const vanityEventDetailsRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/@{$handle}/events/$eventId/details',
  component: () => {
    const { handle, eventId } = vanityEventDetailsRoute.useParams()
    return <PublicDetailsRouteView kind="event" id={eventId} handle={handle} />
  },
})

function CanonicalEventView() {
  const { theme, mode } = useThemeMode()
  const { handle, eventId } = vanityEventLandingRoute.useParams()
  const resolved = useResolveHandle(handle)
  const event = usePublicEvent(eventId)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (location.pathname !== `/@${handle}/events/${eventId}`) return
    if (resolved.data?.type !== 'open_mic' || event.data?.open_mic_id !== resolved.data.id || !event.data.open_mic_handle) return
    const canonical = `/@${event.data.open_mic_handle}/events/${event.data.id}`
    if (location.pathname !== canonical) void navigate({
      to: '/@{$handle}/events/$eventId', params: { handle: event.data.open_mic_handle, eventId: event.data.id },
      search: gallerySearchSchema(location.search), hash: location.hash, state: location.state, replace: true,
    })
  }, [handle, eventId, resolved.data, event.data, location.pathname, location.search, location.hash, location.state, navigate])
  if (resolved.isPending || event.isPending) return <ReadState message={i18n.t('loading')} />
  if (resolved.isError || event.isError || resolved.data?.type !== 'open_mic' || event.data?.open_mic_id !== resolved.data.id) return <ReadState message={i18n.t('publicDetailsUnavailable')} />
  return <RoutedView theme={theme} mode={mode}><EventPage id={eventId} theme={theme} mode={mode} /></RoutedView>
}
const vanityEventLandingRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/@{$handle}/events/$eventId',
  validateSearch: gallerySearchSchema, component: CanonicalEventView,
})

const routeTree = rootRoute.addChildren([
  discoveryRoute,
  homeRoute,
  themeRoute,
  securityRoute,
  authRoute,
  dashboardRoute,
  claimableRegistrationsRoute,
  profileManagementRoute,
  accountRoute,
  seriesNewRoute,
  seriesEditRoute,
  seriesEventsRoute,
  eventNewRoute,
  eventEditRoute,
  eventRosterRoute,
  eventKioskRoute,
  eventMediaManageRoute,
  seriesMediaManageRoute,
  mediaDeepLinkRoute,
  profileEditRoute,
  profileRoute,
  eventDetailRoute,
  registrationRoute,
  openMicRoute,
  openMicRegistrationRoute,
  vanityRegistrationRoute,
  vanityOpenMicRoute,
  seriesDetailsRoute,
  eventDetailsRoute,
  vanitySeriesDetailsRoute,
  vanityEventDetailsRoute,
  vanityEventLandingRoute,
])

const history = createBrowserHistory()
const pageNavigation = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation')[0] : undefined
if (typeof PerformanceNavigationTiming !== 'undefined' && pageNavigation instanceof PerformanceNavigationTiming && pageNavigation.type === 'reload') {
  history.replace(history.location.href, { ...history.location.state, detailGallerySeed: undefined })
}
export const router = createRouter({ routeTree, history, defaultPreload: 'intent', scrollRestoration: true })

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
