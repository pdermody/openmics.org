import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailPage } from '../views/DetailPage'
import { renderWithProviders } from './render'
import { server } from './server'

const event = {
  id: 'event-1',
  public_code: 'LIVE1',
  open_mic_id: 'open-mic-1',
  title: 'Friday Stage',
  starts_at: '2026-10-01T19:00:00.000Z',
  ends_at: '2026-10-01T22:00:00.000Z',
  time_zone: 'Europe/Dublin',
  venue_name: 'The Lantern',
  city: 'Dublin',
  country: 'IE',
  activities: ['singing'],
  tags: [],
  capacity: null,
  registrations_closed_at: null as string | null,
  notes: 'A welcoming night for new voices.',
  status: 'published' as const,
  phase: 'future' as const,
}

const openMic = {
  id: 'open-mic-1',
  public_code: 'STAGE',
  current_handle: null,
  name: 'Friday Stage',
  description: null,
  venue_name: 'The Lantern',
  city: 'Dublin',
  country: 'IE',
  activities: ['singing'],
  tags: [],
  registration_mode: 'both' as const,
  external_registration_url: null,
  status: 'active',
}

function registerHandlers(currentEvent = event) {
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
    http.get('/api/events/LIVE1', () => HttpResponse.json(currentEvent)),
    http.get('/api/open-mics/open-mic-1', () => HttpResponse.json(openMic)),
  )
}

describe('DetailPage event registration action', () => {
  it('links to registration while registration is open', async () => {
    registerHandlers()
    renderWithProviders(<DetailPage kind="event" id="LIVE1" theme="venue" mode="light" />)

    expect(await screen.findByRole('heading', { name: 'Friday Stage' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Register for this event' })).toHaveAttribute('href', '/events/LIVE1/register')
  })

  it('disables registration when the event is closed', async () => {
    registerHandlers({ ...event, registrations_closed_at: '2026-09-01T19:00:00.000Z' })
    renderWithProviders(<DetailPage kind="event" id="LIVE1" theme="venue" mode="light" />)

    const closedButton = await screen.findByRole('button', { name: 'Registration closed' })
    expect(closedButton).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Register for this event' })).not.toBeInTheDocument()
  })
})