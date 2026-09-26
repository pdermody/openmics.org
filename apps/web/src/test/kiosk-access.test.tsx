import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KioskPage } from '../views/KioskPage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('KioskPage access control', () => {
  it('does not expose kiosk controls to an anonymous visitor', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
      http.get('/api/open-mics/series-1', () => HttpResponse.json({ id: 'series-1', registration_mode: 'both', status: 'active' })),
      http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
        id: 'event-1',
        title: 'Friday Stage',
        starts_at: '2026-10-01T19:00:00.000Z',
        ends_at: '2026-10-01T22:00:00.000Z', status: 'published', phase: 'running',
        registrations_closed_at: null,
        venue_name: 'The Lantern',
        city: 'Dublin',
      })),
      http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
    )

    renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('status')).toHaveTextContent('Sign in as this event\'s organizer to run the kiosk.')
    expect(screen.queryByRole('button', { name: 'Add to roster' })).not.toBeInTheDocument()
  })
})