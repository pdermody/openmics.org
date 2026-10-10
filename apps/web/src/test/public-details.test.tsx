import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PublicDetailsPage } from '../views/PublicDetailsPage'
import { PublicLocation } from '../components/location/PublicLocation'
import { AttendanceWarning } from '../components/AttendanceWarning'
import { entryFee, navigationDestination, eventTimeRange, isOpenMicsWebsite } from '../features/publicDetails'
import { i18n } from '../i18n'
import { createTestQueryClient, renderWithProviders } from './render'
import App, { router } from '../App'
import { server } from './server'

const mapLoaded = vi.fn()
let mapFails = false
vi.mock('../components/location/PublicVenueMap', () => ({
  PublicVenueMap: () => {
    if (mapFails) throw new Error('Map failed')
    mapLoaded()
    return <div role="img" aria-label="Venue map" />
  },
}))

const series = {
  id: 'series-1', public_code: 'SERIES', owner_profile_id: 'owner', current_handle: null,
  name: 'Open stage', description: 'Description of the series', public_information: 'Bring your instrument',
  venue_name: 'The Venue', address_line1: '1 Main Street', city: 'Dublin', country: 'IE',
  lat: 0, lng: 0, time_zone: 'Europe/Dublin', activities: ['singing'], tags: ['acoustic'],
  originals_only: true, amplification_available: false, age_policy: 'both' as const,
  website: 'https://example.test', schedule_summary: 'Every Friday', schedule_details: 'Arrive early',
  entry_fee_amount: 0, entry_fee_currency: null, entry_fee_note: null,
  registration_mode: 'both' as const, external_registration_url: null, status: 'active' as const,
}
const event = {
  ...series,
  id: 'event-1', public_code: 'EVENT', open_mic_id: 'series-1', title: 'Special stage',
  starts_at: '2026-10-17T21:00:00Z', ends_at: '2026-10-18T00:00:00Z', time_zone: 'Europe/Dublin',
  status: 'published', phase: 'future', registrations_closed_at: null,
  public_information: 'Public event instructions', notes: 'PRIVATE SECRET',
}

describe('public details experience', () => {
  it('returns from More details to the landing browsing state', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const canonicalSeries = { ...series, current_handle: 'Open-Stage' }
    server.use(
      http.get('/api/handles/Open-Stage', () => HttpResponse.json({ type: 'open_mic', id: series.id })),
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json(canonicalSeries)),
      http.get('/api/open-mics/series-1/next-event', () => HttpResponse.json({ current_event: null, next_event: null })),
      http.get('/api/open-mics/series-1/featured-media', () => HttpResponse.json({ items: [] })),
      http.get('/api/open-mics/series-1/media', () => HttpResponse.json({ items: [], next_cursor: null, prev_cursor: null })),
      http.get('/api/open-mics/series-1/public-events', () => HttpResponse.json({ items: [], pagination: { total: 0, page: 1, page_size: 10 }, available_years: [] })),
    )
    render(<QueryClientProvider client={createTestQueryClient()}><App /></QueryClientProvider>)
    await router.navigate({ to: '/@{$handle}', params: { handle: 'Open-Stage' }, search: { tab: 'photos', page: 2 } })
    const detailsLink = await screen.findByRole('link', { name: 'More details' })
    await userEvent.setup().click(detailsLink)
    await screen.findByRole('heading', { name: 'More details - Open stage' })
    await waitFor(() => {
      expect(router.state.location.hash).toBe('')
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'More details - Open stage' }))
    })
    expect(screen.queryByRole('img', { name: 'Venue map' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('link', { name: 'Back to open mic' }))
    await screen.findByRole('heading', { name: 'Open stage' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/@Open-Stage')
      expect(router.state.location.search).toMatchObject({ tab: 'photos', page: 2 })
      expect(document.activeElement?.id).toBe('details-all')
      expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    })
  })

  it('shows full series details and a back link without loading a map', async () => {
    mapLoaded.mockClear()
    server.use(
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json(series)),
      http.get('/api/open-mics/series-1/next-event', () => HttpResponse.json({ current_event: null, next_event: null })),
    )
    renderWithProviders(<PublicDetailsPage kind="open-mic" id="series-1" theme="venue" mode="light" />)
    expect(await screen.findByText('Description of the series')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What to expect' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The vibe' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Taking the stage' })).toBeInTheDocument()
    for (const name of ['Schedule', 'Entry', 'Registration', 'Location']) {
      expect(screen.getByRole('heading', { name, level: 3 }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
    expect(screen.getByRole('complementary', { name: 'Before you go' })).toHaveTextContent('Free entry')
    expect(screen.getByRole('complementary', { name: 'Before you go' })).toHaveTextContent('1 Main Street')
    expect(screen.getByText('Every Friday')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', series.website)
    expect(screen.getByRole('link', { name: 'Back to open mic' })).toHaveAttribute('href', '/open-mics/series-1')
    expect(screen.getByText('1 Main Street, Dublin, IE')).toBeInTheDocument()
    expect(mapLoaded).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show map' }))
    expect(await screen.findByRole('img', { name: 'Venue map' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'The Venue' })).toBeInTheDocument()
    expect(mapLoaded).toHaveBeenCalled()
    await userEvent.setup().keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show map' })).toHaveFocus()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show map' }))
    expect(await screen.findByRole('img', { name: 'Venue map' })).toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    await userEvent.setup().tab()
    expect(close).toHaveFocus()
    await userEvent.setup().click(close)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show map' })).toHaveFocus()
  })

  it('never renders legacy private notes on event details', async () => {
    server.use(
      http.get('/api/events/event-1/public-details', () => HttpResponse.json(event)),
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json(series)),
      http.get('/api/events/event-1/attendance-status', () => HttpResponse.json({ status: 'below_limit' })),
    )
    renderWithProviders(<PublicDetailsPage kind="event" id="event-1" theme="venue" mode="light" />)
    expect(await screen.findByText('Public event instructions')).toBeInTheDocument()
    expect(screen.getByText('Open-mic policies')).toHaveClass('public-details-small-label')
    expect(screen.getByRole('heading', { name: 'Activities' })).toHaveClass('public-details-small-label')
    expect(screen.queryByText('PRIVATE SECRET')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to event' })).toHaveAttribute('href', '/events/event-1')
  })

  it('keeps a sparse series honest and does not offer registration without an eligible event', async () => {
    server.use(
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json({ ...series, description: null, public_information: null, activities: [], tags: [] })),
      http.get('/api/open-mics/series-1/next-event', () => HttpResponse.json({ current_event: null, next_event: null, next_registration_event: null })),
    )
    renderWithProviders(<PublicDetailsPage kind="open-mic" id="series-1" theme="venue" mode="light" />)
    expect(await screen.findByText('The organizer has not added an introduction yet. Explore the practical details below.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Register for any event' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Drive with Apple Maps' })).toBeInTheDocument()
  })

  it.each(['open-mic', 'event'] as const)('hides an OpenMics website on %s details', async (kind) => {
    server.use(
      http.get('/api/open-mics/series-1/public-details', () => HttpResponse.json({ ...series, website: 'https://www.openmics.org/@stage' })),
      http.get('/api/events/event-1/public-details', () => HttpResponse.json(event)),
      http.get('/api/events/event-1/attendance-status', () => HttpResponse.json({ status: 'below_limit' })),
      http.get('/api/open-mics/series-1/next-event', () => HttpResponse.json({ current_event: null, next_event: null })),
    )
    renderWithProviders(<PublicDetailsPage kind={kind} id={kind === 'event' ? 'event-1' : 'series-1'} theme="venue" mode="light" />)
    await screen.findByRole('heading', { name: 'What to expect' })
    expect(screen.queryByRole('link', { name: 'Website' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open-mic website' })).not.toBeInTheDocument()
  })

  it('uses address-based directions when no precise pin exists', () => {
    renderWithProviders(<PublicLocation location={{ ...series, lat: null, lng: null }} />)
    const google = new URL(screen.getByRole('link', { name: 'Drive with Google Maps' }).getAttribute('href')!)
    expect(google.searchParams.get('destination')).toBe('1 Main Street, Dublin, IE')
    expect(google.searchParams.get('travelmode')).toBe('driving')
    expect(google.searchParams.has('origin')).toBe(false)
    const apple = new URL(screen.getByRole('link', { name: 'Drive with Apple Maps' }).getAttribute('href')!)
    expect(apple.searchParams.get('daddr')).toBe('1 Main Street, Dublin, IE')
    expect(apple.searchParams.get('dirflg')).toBe('d')
    expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument()
  })

  it('retains directions on map failure and allows an explicit retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mapFails = true
    renderWithProviders(<PublicLocation location={series} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show map' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The venue map could not load.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('link', { name: 'Drive with Google Maps' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show map' }))
    mapFails = false
    await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('discoveryRetry') }))
    expect(await screen.findByRole('img', { name: 'Venue map' })).toBeInTheDocument()
  })

  it('shows a warning, but no counts, at capacity', async () => {
    server.use(http.get('/api/events/event-1/attendance-status', () => HttpResponse.json({ status: 'at_capacity' })))
    renderWithProviders(<AttendanceWarning eventId="event-1" phase="future" />)
    expect(await screen.findByText('This event is at capacity.')).toBeInTheDocument()
    expect(screen.getByText('You may have trouble finding seating or performing.')).toBeInTheDocument()
  })

  it('surfaces attendance read failure instead of claiming availability', async () => {
    server.use(http.get('/api/events/event-1/attendance-status', () => HttpResponse.json({}, { status: 503 })))
    renderWithProviders(<AttendanceWarning eventId="event-1" phase="future" />)
    await waitFor(() => expect(screen.getByText('Attendance information is unavailable or incomplete.')).toBeInTheDocument())
  })
})

describe('public detail formatting', () => {
  it('matches the OpenMics domain, not unrelated domains or URL text', () => {
    for (const url of ['https://openmics.org', 'http://WWW.OPENMICS.ORG/path', 'https://stage.openmics.org', 'https://openmics.org.:443']) {
      expect(isOpenMicsWebsite(url)).toBe(true)
    }
    for (const url of ['https://notopenmics.org', 'https://openmics.org.example.test', 'https://example.test/openmics.org']) {
      expect(isOpenMicsWebsite(url)).toBe(false)
    }
  })
  it('keeps zero coordinates precise and rejects missing destination data', () => {
    expect(navigationDestination(series).destination).toBe('0,0')
    expect(navigationDestination({ ...series, lat: null, lng: null, address_line1: '' }).destination).toBeNull()
  })
  it('honors fee notes, known free entry and unknown fees', () => {
    expect(entryFee({ ...series, entry_fee_note: 'Pay what you can' }, 'en', i18n.t)).toBe('Pay what you can')
    expect(entryFee(series, 'en', i18n.t)).toBe('Free entry')
    expect(entryFee({}, 'en', i18n.t)).toBe('Entry fee not specified')
  })
  it('shows both overnight dates and never invents an end time', () => {
    const range = eventTimeRange(event, 'en', i18n.t)
    expect(range).toContain('Oct 17')
    expect(range).toContain('Oct 18')
    expect(eventTimeRange({ ...event, ends_at: null }, 'en', i18n.t)).toContain('End time not specified')
  })
})
