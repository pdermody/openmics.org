import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HomePage } from '../views/HomePage'
import { renderWithProviders } from './render'
import { server } from './server'

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
      http.get('/api/open-mics/series-1', () => HttpResponse.json({
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

    expect(await screen.findByText('No upcoming rooms found near you yet.')).toBeInTheDocument()
    expect(screen.getByText('No open mic series found near you yet.')).toBeInTheDocument()
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
        return HttpResponse.json({ ...signedInAccount, city: 'Cork' })
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

    expect(await screen.findByText('No open mic series found near Cork yet.')).toBeInTheDocument()
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

  it('points signed-in users with no saved city and no location to their account page', async () => {
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

    expect(await screen.findByRole('link', { name: /add a city on your account page/i })).toBeInTheDocument()
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
})
