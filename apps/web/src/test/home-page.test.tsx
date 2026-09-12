import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HomePage } from '../views/HomePage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('HomePage', () => {
  it('renders upcoming events and open mic series for anonymous visitors', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/events/upcoming?limit=6', () => HttpResponse.json([{
        id: 'event-1', public_code: 'LIVE1', open_mic_id: 'series-1', title: 'Friday Stage',
        starts_at: '2026-10-01T19:00:00.000Z', time_zone: 'Europe/Dublin', venue_name: 'The Lantern',
        city: 'Dublin', country: 'IE', activities: ['singing'], tags: [], capacity: null,
        registrations_closed_at: null, notes: null,
      }])),
      http.get('/api/open-mics?page_size=6', () => HttpResponse.json({ items: [{
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
      http.get('/api/events/upcoming?limit=6', () => HttpResponse.json([])),
      http.get('/api/open-mics?page_size=6', () => HttpResponse.json({ items: [], pagination: { page: 1, page_size: 6, total: 0 } })),
    )

    renderWithProviders(<HomePage theme="venue" mode="light" />)

    expect(await screen.findByText('No upcoming rooms found near you yet.')).toBeInTheDocument()
    expect(screen.getByText('No open mic series found near you yet.')).toBeInTheDocument()
  })
})