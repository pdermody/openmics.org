import { cleanup, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDiscoveryStore } from '../features/discovery'
import { DiscoveryPage } from '../views/DiscoveryPage'
import { renderWithProviders } from './render'
import { server } from './server'

beforeEach(() => {
  useDiscoveryStore.setState({ latest: null, entries: {} })
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
  )
})

afterEach(() => { cleanup(); window.localStorage.clear() })

describe('DiscoveryPage', () => {
  it('loads the requested series page and renders numbered navigation', async () => {
    const requests: URL[] = []
    server.use(http.get('/api/open-mics', ({ request }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json({
        items: [{ id: 'series-21', public_code: 'STAGE21', current_handle: null, name: 'Stage 21',
          description: 'A welcoming room', venue_name: 'Venue', city: 'Cork', country: 'IE',
          activities: [], tags: [], registration_mode: 'both', external_registration_url: null, status: 'active' }],
        pagination: { page: 2, page_size: 20, total: 25 },
      })
    }))
    renderWithProviders(<DiscoveryPage theme="venue" mode="light" tab="open-mics" page={2} />)
    expect(await screen.findByRole('heading', { name: 'Stage 21' })).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get('page')).toBe('2')
    expect(requests[0].searchParams.get('page_size')).toBe('20')
    expect(screen.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/discover?tab=open-mics&page=1')
    expect(screen.getByText('25 results')).toBeInTheDocument()
  })

  it('loads only the active events tab and keeps general empty copy location-neutral', async () => {
    let seriesReads = 0
    let eventReads = 0
    server.use(
      http.get('/api/open-mics', () => { seriesReads++; return HttpResponse.json({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }) }),
      http.get('/api/events/discovery', () => { eventReads++; return HttpResponse.json({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }) }),
    )
    renderWithProviders(<DiscoveryPage theme="venue" mode="light" tab="events" page={1} />)
    expect(await screen.findByText('No upcoming events found. Choose a city to explore.')).toBeInTheDocument()
    expect(eventReads).toBe(1)
    expect(seriesReads).toBe(0)
    expect(screen.getByRole('link', { name: 'Upcoming events' })).toHaveAttribute('aria-current', 'page')
  })

  it('distinguishes an out-of-range page from an empty search', async () => {
    server.use(http.get('/api/open-mics', () => HttpResponse.json({ items: [], pagination: { page: 3, page_size: 20, total: 25 } })))
    renderWithProviders(<DiscoveryPage theme="venue" mode="light" tab="open-mics" page={3} />)
    expect(await screen.findByText('There are no results on this page. Return to an earlier page.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/discover?tab=open-mics&page=2')
  })
})
