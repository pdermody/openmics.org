import { lazy, Suspense } from 'react'
import { http, HttpResponse } from 'msw'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { KioskPage } from '../views/KioskPage'
import { renderWithProviders } from './render'
import { server } from './server'

beforeEach(() => {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
})

afterEach(() => {
  window.localStorage.clear()
})

function registerOrganizerHandlers(registrationMode: 'both' | 'on_night_only' = 'both', phase: 'running' | 'future' | 'past' = 'running') {
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({
      id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
      preferred_language: null, current_profile_id: 'profile-1', is_platform_admin: false, plan: 'free',
    })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
      id: 'profile-1', profile_name: 'Stage Organizer', profile_kind: 'organizer', current_handle: null,
      bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null,
    }] })),
    http.get('/api/me/permissions', ({ request }) => {
      expect(new URL(request.url).searchParams.get('profile')).toBe('profile-1')
      return HttpResponse.json({ permissions: ['profiles:manage'] })
    }),
    http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
      id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
      ends_at: '2026-10-01T22:00:00.000Z', status: 'published', phase, registrations_closed_at: '2026-09-01T19:00:00.000Z', venue_name: 'The Lantern', city: 'Dublin',
    })),
    http.get('/api/open-mics/series-1', () => HttpResponse.json({
      id: 'series-1', public_code: 'STAGE123', current_handle: null, name: 'Friday Stage',
      registration_mode: registrationMode, status: 'active',
    })),
    http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
  )
}

describe('KioskPage behavior', () => {
  it('confirms the event date before opening a future kiosk', async () => {
    registerOrganizerHandlers('both', 'future')
    const LazyKiosk = lazy(async () => ({ default: KioskPage }))
    renderWithProviders(<Suspense fallback={<main className="app">Loading...</main>}>
      <LazyKiosk seriesId="series-1" eventId="event-1" theme="venue" mode="light" />
    </Suspense>)

    const dialog = await screen.findByRole('dialog', { name: 'Confirm kiosk event' })
    expect(dialog.closest('.app')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Friday Stage')
    expect(screen.queryByRole('button', { name: 'Add to roster' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open kiosk' }))
    expect(await screen.findByRole('button', { name: 'Add to roster' })).toBeInTheDocument()
  }, 15000)

  it('enters directly with the configured server PIN and permits organizer kiosk sign-ups when public registration is closed', async () => {
    registerOrganizerHandlers()
    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('button', { name: 'Add to roster' })).toBeInTheDocument()
  })

  it('shows the series QR only when pre-registration is allowed', async () => {
    registerOrganizerHandlers('on_night_only')
    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('button', { name: 'Add to roster' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Register for any event' })).not.toBeInTheDocument()
  })

  it('routes Escape through the PIN gate instead of leaving the kiosk', async () => {
    registerOrganizerHandlers()
    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    await screen.findByRole('button', { name: 'Add to roster' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(await screen.findByRole('heading', { name: 'Enter PIN to exit kiosk' })).toBeInTheDocument()
  })

  it('returns from the PIN lock screen to the kiosk when Escape is pressed again', async () => {
    registerOrganizerHandlers()
    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    await screen.findByRole('button', { name: 'Add to roster' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByRole('heading', { name: 'Enter PIN to exit kiosk' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(await screen.findByRole('button', { name: 'Add to roster' })).toBeInTheDocument()
  })

  it('traps browser Back and opens the PIN gate from the active kiosk', async () => {
    registerOrganizerHandlers()
    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    await screen.findByRole('button', { name: 'Add to roster' })
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(await screen.findByRole('heading', { name: 'Enter PIN to exit kiosk' })).toBeInTheDocument()
  })
})