import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
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
        running: false, registrations_closed_at: null, venue_name: 'The Lantern', city: 'Dublin',
      })),
    )

    renderWithProviders(<EventRosterPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    expect(await screen.findByRole('status')).toHaveTextContent('Sign in to manage this event\'s roster.')
    expect(screen.queryByRole('button', { name: 'Stop registrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open kiosk' })).not.toBeInTheDocument()
  })
})