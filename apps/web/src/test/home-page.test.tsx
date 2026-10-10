import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HomePage } from '../views/HomePage'
import { renderWithProviders } from './render'
import { server } from './server'
import { useDiscoveryStore } from '../features/discovery'

beforeEach(() => {
  mockGeolocationPermission('denied')
  useDiscoveryStore.setState({ latest: null, entries: {} })
  server.use(http.get('/api/discovery/suggestions', () => HttpResponse.json({ expansion: null, cities: [] })))
})

function mockGeolocationPermission(state: PermissionState, coords?: { lat: number; lng: number }) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state, addEventListener: () => undefined }) },
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback) => {
        if (coords) success({ coords: { latitude: coords.lat, longitude: coords.lng } } as GeolocationPosition)
      },
    },
  })
}

afterEach(() => {
  cleanup()
  delete (navigator as unknown as { permissions?: unknown }).permissions
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
  window.localStorage.clear()
})

const anonymousHandlers = [
  http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
  http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
]

const signedInAccount = {
  id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
  preferred_language: 'en', current_profile_id: null, is_platform_admin: false, plan: 'free',
}

const cork = {
  id: 'city-cork', city: 'Cork', city_ascii: 'Cork', country: 'Ireland', country_ascii: 'Ireland',
  iso2: 'IE', iso3: 'IRL', admin_name: null, lat: 51.8985, lng: -8.4756, population: 222333, retired: false,
}

describe('HomePage', () => {
  it('renders upcoming events and open mic series for anonymous visitors', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
      http.get('/api/events/upcoming', () => HttpResponse.json([{
        id: 'event-1', public_code: 'LIVE1', open_mic_id: 'series-1', title: 'Friday Stage',
        starts_at: '2026-10-01T19:00:00.000Z', time_zone: 'Europe/Dublin', venue_name: 'The Lantern',
        city: 'Dublin', country: 'IE', activities: ['singing'], tags: [], capacity: null,
        registrations_closed_at: null, notes: null,
      }])),
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json({
        id: 'series-1', public_code: 'STAGE', current_handle: null, name: 'Friday Stage',
        description: 'A welcoming room for new voices.', venue_name: 'The Lantern', city: 'Dublin',
        country: 'IE', activities: ['singing'], tags: [], registration_mode: 'both',
        external_registration_url: null, status: 'active',
      })),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [{
        id: 'series-1', public_code: 'STAGE', current_handle: null, name: 'Friday Stage',
        description: 'A welcoming room for new voices.', venue_name: 'The Lantern', city: 'Dublin',
        country: 'IE', activities: ['singing'], tags: [], registration_mode: 'both',
        external_registration_url: null, status: 'active',
      }], pagination: { page: 1, page_size: 6, total: 1 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect((await screen.findAllByRole('heading', { name: 'Friday Stage' }))).toHaveLength(2)
    expect(screen.getByText('Open mic series nearby')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Friday Stage/i })).toHaveLength(2)
  })

  it('shows empty states when no public content is available', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByText('No upcoming events found. Choose a city to explore.')).toBeInTheDocument()
    expect(screen.getByText('No open mic series found. Choose a city to explore.')).toBeInTheDocument()
  })

  it('uses browser location silently when permission is already granted, without showing the opt-in button', async () => {
    mockGeolocationPermission('granted', { lat: 53.35, lng: -6.26 })
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByText('Rooms near you')).toBeInTheDocument()
    expect(screen.getByText('Open mic series near you')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('waits for the saved city and browser permission before loading discovery results', async () => {
    mockGeolocationPermission('denied')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    const eventRequests: string[] = []
    const seriesRequests: string[] = []
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ ...signedInAccount, city: 'Cork', city_id: cork.id, city_location: cork })
      }),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
      http.get('/api/events/upcoming', ({ request }) => {
        eventRequests.push(request.url)
        return HttpResponse.json([])
      }),
      http.get('/api/open-mics', ({ request }) => {
        seriesRequests.push(request.url)
        return HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })
      }),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByText('No open mic series found within 50 km of Cork. Search farther away or choose another city.')).toBeInTheDocument()
    await waitFor(() => {
      expect(eventRequests).toHaveLength(1)
      expect(seriesRequests).toHaveLength(1)
    })
    expect(new URL(eventRequests[0]).searchParams.get('near')).toBe('51.8985,-8.4756')
    expect(new URL(seriesRequests[0]).searchParams.get('near')).toBe('51.8985,-8.4756')
  })

  it('shows an opt-in button when permission has not been decided, and uses the granted location once clicked', async () => {
    const user = userEvent.setup()
    mockGeolocationPermission('prompt', { lat: 53.35, lng: -6.26 })
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    const optInButton = await screen.findByRole('button', { name: /use my location/i })
    await user.click(optInButton)

    expect(await screen.findByText('Rooms near you')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('falls back to generic copy, with no opt-in button or nagging, when location is denied and there is no saved city', async () => {
    mockGeolocationPermission('denied')
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByText('Rooms worth showing up for')).toBeInTheDocument()
    expect(screen.getByText('Open mic series nearby')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('lets signed-in users explore a city without changing their account preferences', async () => {
    mockGeolocationPermission('denied')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json(signedInAccount)),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByRole('button', { name: /choose a city/i })).toBeInTheDocument()
  })

  it('does not show the add-city hint for anonymous visitors', async () => {
    mockGeolocationPermission('denied')
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    await screen.findByText('Rooms worth showing up for')
    expect(screen.queryByRole('link', { name: /add a city on your account page/i })).not.toBeInTheDocument()
  })

  it('expands both previews only after the suggested action is selected', async () => {
    mockGeolocationPermission('granted', { lat: 53.35, lng: -6.26 })
    const radii: { events: string[]; series: string[] } = { events: [], series: [] }
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', ({ request }) => {
        radii.events.push(new URL(request.url).searchParams.get('radius_km')!)
        return HttpResponse.json([])
      }),
      http.get('/api/open-mics', ({ request }) => {
        radii.series.push(new URL(request.url).searchParams.get('radius_km')!)
        return HttpResponse.json({ items: [], pagination: { page: 1, page_size: 3, total: 0 } })
      }),
      http.get('/api/discovery/suggestions', ({ request }) => HttpResponse.json({
        expansion: new URL(request.url).searchParams.get('radius_km') === '50' ? { radius_km: 135, additional_count: 22 } : null,
        cities: [],
      })),
    )
    renderWithProviders(<HomePage theme="venue" mode="light" />)
    const expand = await screen.findByRole('button', { name: /expand to 135 km.*22 more open mics/i })
    expect(radii.events).toEqual(['50'])
    expect(radii.series).toEqual(['50'])
    await userEvent.setup().click(expand)
    await waitFor(() => {
      expect(radii.events).toEqual(['50', '135'])
      expect(radii.series).toEqual(['50', '135'])
    })
    expect(screen.getByRole('link', { name: /view all upcoming events/i })).toHaveAttribute('href', expect.stringContaining('/discover'))
  })

  it('offers a smaller inventory at 200 km alongside cities with public listings', async () => {
    mockGeolocationPermission('granted', { lat: 53.35, lng: -6.26 })
    const origins: string[] = []
    server.use(
      ...anonymousHandlers,
      http.get('/api/events/upcoming', () => HttpResponse.json([])),
      http.get('/api/open-mics', ({ request }) => {
        origins.push(new URL(request.url).searchParams.get('near')!)
        return HttpResponse.json({ items: [], pagination: { page: 1, page_size: 3, total: 0 } })
      }),
      http.get('/api/discovery/suggestions', () => HttpResponse.json({
        expansion: { radius_km: 200, additional_count: 8 },
        cities: [{ ...cork, open_mic_count: 4, distance_km: 218 }],
      })),
    )
    renderWithProviders(<HomePage theme="venue" mode="light" />)
    expect(await screen.findByRole('button', { name: /show 8 more open mics within 200 km/i })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /Cork, Ireland.*4 open mics/i }))
    await waitFor(() => expect(origins).toContain('51.8985,-8.4756'))
    expect(screen.getByText('Near Cork, Ireland · Within 50 km')).toBeInTheDocument()
  })
})
