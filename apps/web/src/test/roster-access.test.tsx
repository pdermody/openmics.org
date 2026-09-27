import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EventRosterPage } from '../views/EventRosterPage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('EventRosterPage access state', () => {
  it('does not expose roster controls to anonymous visitors', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
      http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
        id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
        ends_at: '2026-10-01T22:00:00.000Z', status: 'published', phase: 'running', registrations_closed_at: null, venue_name: 'The Lantern', city: 'Dublin',
      })),
    )

    renderWithProviders(<EventRosterPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('status')).toHaveTextContent('Sign in to manage this event\'s roster.')
    expect(screen.queryByRole('button', { name: 'Stop registrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open kiosk' })).not.toBeInTheDocument()
  })

  it.each(['on_night_only', 'external'] as const)('hides registration controls for %s series', async (registrationMode) => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    let registrationModeLoaded = false
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ id: 'account-1', email: 'organizer@example.test', current_profile_id: 'profile-1' })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
        id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer',
      }] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/open-mics/series-1', () => {
        registrationModeLoaded = true
        return HttpResponse.json({ id: 'series-1', registration_mode: registrationMode })
      }),
      http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
        id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
        ends_at: '2026-10-01T22:00:00.000Z', status: 'published', phase: 'running',
        registrations_closed_at: null, venue_name: 'The Lantern', city: 'Dublin',
      })),
      http.get('/api/events/event-1/registrations', () => HttpResponse.json([])),
      http.post('/api/events/event-1/roster/stream-token', () => HttpResponse.json({ stream_token: 'test-token', expires_at: '2026-10-01T20:00:00.000Z' })),
    )

    renderWithProviders(<EventRosterPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    await waitFor(() => expect(registrationModeLoaded).toBe(true))
    expect(screen.queryByRole('button', { name: 'Stop registrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen registrations' })).not.toBeInTheDocument()
    expect(screen.queryByText('Registrations open')).not.toBeInTheDocument()
    expect(screen.queryByText('Registrations closed')).not.toBeInTheDocument()
  })

  it('shows the registration control for online-registration series', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ id: 'account-1', email: 'organizer@example.test', current_profile_id: 'profile-1' })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
        id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer',
      }] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/open-mics/series-1', () => HttpResponse.json({ id: 'series-1', registration_mode: 'both' })),
      http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
        id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
        ends_at: '2026-10-01T22:00:00.000Z', status: 'published', phase: 'running',
        registrations_closed_at: null, venue_name: 'The Lantern', city: 'Dublin',
      })),
      http.get('/api/events/event-1/registrations', () => HttpResponse.json([])),
      http.post('/api/events/event-1/roster/stream-token', () => HttpResponse.json({ stream_token: 'test-token', expires_at: '2026-10-01T20:00:00.000Z' })),
    )

    renderWithProviders(<EventRosterPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('button', { name: 'Stop registrations' })).toBeInTheDocument()
  })
})