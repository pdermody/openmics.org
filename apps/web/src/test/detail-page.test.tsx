import { http, HttpResponse } from 'msw'
import { screen, within } from '@testing-library/react'
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
    http.get('/api/events/LIVE1/public-details', () => HttpResponse.json(currentEvent)),
    http.get('/api/open-mics/open-mic-1/public-details', () => HttpResponse.json(openMic)),
    http.get('/api/events/event-1/attendance-status', () => HttpResponse.json({ status: 'below_limit' })),
    http.get('/api/events/event-1/media', () => HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })),
  )
}

describe('DetailPage event registration action', () => {
  it('links to registration while registration is open', async () => {
    registerHandlers()
    renderWithProviders(<DetailPage kind="event" id="LIVE1" theme="venue" mode="light" />)

    expect(await screen.findByRole('heading', { name: 'Friday Stage' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Register for this event' })).toHaveAttribute('href', '/events/LIVE1/register')
    const details = screen.getByRole('link', { name: 'More details' })
    const venue = within(details.closest<HTMLElement>('.detail-facts')!).getByText('The Lantern, Dublin')
    expect(venue.tagName).toBe('SPAN')
    expect(venue.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'View location for The Lantern' })).not.toBeInTheDocument()
  })

  describe('DetailPage series facts and registration', () => {
    function seriesHandlers(hasEvent: boolean, registrationOpen = true) {
      registerHandlers()
      server.use(
        http.get('/api/open-mics/STAGE/public-details', () => HttpResponse.json({ ...openMic, tags: ['acoustic'] })),
        http.get('/api/open-mics/STAGE/next-event', () => HttpResponse.json({
          current_event: null, next_event: hasEvent ? event : null,
          next_registration_event: hasEvent && registrationOpen ? event : null,
        })),
        http.get('/api/open-mics/open-mic-1/featured-media', () => HttpResponse.json({ items: [] })),
        http.get('/api/open-mics/open-mic-1/public-events', () => HttpResponse.json({
          items: hasEvent ? [event] : [], pagination: { page: 1, page_size: 10, total: hasEvent ? 1 : 0 }, available_years: [],
        })),
      )
    }

    it('places the non-interactive venue after badges and before More details', async () => {
      seriesHandlers(false)
      renderWithProviders(<DetailPage kind="open-mic" id="STAGE" theme="venue" mode="light" />)
      const details = await screen.findByRole('link', { name: 'More details' })
      const facts = details.closest<HTMLElement>('.detail-facts')!
      const venue = within(facts).getByText('The Lantern, Dublin')
      const tag = within(facts).getByText('acoustic')
      expect(venue.tagName).toBe('SPAN')
      expect(tag.compareDocumentPosition(venue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(venue.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByRole('link', { name: 'View location for The Lantern' })).not.toBeInTheDocument()
      await screen.findByText('No upcoming events announced yet. You can still browse past events.')
      expect(screen.queryByRole('link', { name: 'Register for any event' })).not.toBeInTheDocument()
    })

    it('places registration beside the highlighted event instead of in the header actions', async () => {
      seriesHandlers(true)
      renderWithProviders(<DetailPage kind="open-mic" id="STAGE" theme="venue" mode="light" />)
      const registration = await screen.findByRole('link', { name: 'Register for any event' })
      expect(registration).toHaveAttribute('href', '/open-mics/STAGE/register')
      expect(registration.closest('.series-next-event')).not.toBeNull()
    })

    it('omits registration when upcoming events have no eligible registration event', async () => {
      seriesHandlers(true, false)
      renderWithProviders(<DetailPage kind="open-mic" id="STAGE" theme="venue" mode="light" />)
      await screen.findByText('Next event')
      expect(screen.queryByRole('link', { name: 'Register for any event' })).not.toBeInTheDocument()
    })
  })

  it('disables registration when the event is closed', async () => {
    registerHandlers({ ...event, registrations_closed_at: '2026-09-01T19:00:00.000Z' })
    renderWithProviders(<DetailPage kind="event" id="LIVE1" theme="venue" mode="light" />)

    const closedButton = await screen.findByRole('button', { name: 'Registration closed' })
    expect(closedButton).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Register for this event' })).not.toBeInTheDocument()
  })

  it('does not load an unpublished event on a public page even for its owner', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    const publicViewValues: Array<string | null> = []
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1',
        current_profile_id: 'organizer-profile',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({
        items: [{ id: 'organizer-profile', profile_name: 'Organizer', profile_kind: 'organizer' }],
      })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/events/DRAFT1/public-details', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Event not found' } }, { status: 404 })),
      http.get('/api/events/event-1/media', ({ request }) => {
        publicViewValues.push(new URL(request.url).searchParams.get('public_view'))
        return HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })
      }),
    )

    renderWithProviders(<DetailPage kind="event" id="DRAFT1" theme="venue" mode="light" />)

    await screen.findByText('We could not find that page or event. It may have been removed or is no longer public.')
    expect(publicViewValues).toHaveLength(0)
  })
})

describe('DetailPage owner action gating', () => {
  const seriesWithOwner = { ...openMic, owner_profile_id: 'organizer-profile' }

  function signInAsPerformer() {
    // Active profile is a performer; the account also owns the organizer profile that owns
    // the series — the buttons must key off the ACTIVE profile, not any account profile.
    window.localStorage.setItem('openmic-simulated-auth-token', 'performer-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ id: 'account-1', email: 'p@example.test', current_profile_id: 'performer-profile' })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [
        { id: 'performer-profile', profile_name: 'Performer', profile_kind: 'performer' },
        { id: 'organizer-profile', profile_name: 'Organizer', profile_kind: 'organizer' },
      ] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/open-mics/STAGE/public-details', () => HttpResponse.json(seriesWithOwner)),
      http.get('/api/open-mics/open-mic-1/public-events', () => HttpResponse.json({
        items: [event], pagination: { page: 1, page_size: 10, total: 1 }, available_years: [],
      })),
      http.get('/api/open-mics/open-mic-1/media', () => HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })),
      http.get('/api/open-mics/open-mic-1/featured-media', () => HttpResponse.json({ items: [] })),
    )
  }

  it('hides owner actions from a performer whose account owns the series via another profile', async () => {
    signInAsPerformer()
    renderWithProviders(<DetailPage kind="open-mic" id="STAGE" theme="venue" mode="light" />)

    expect(await screen.findByRole('heading', { name: 'Friday Stage' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage media' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Copy Friday Stage' })).not.toBeInTheDocument()
  })

  it('offers owner-organizers a copy action with the displayed series event preselected', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ id: 'account-1', email: 'o@example.test', current_profile_id: 'organizer-profile' })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [
        { id: 'organizer-profile', profile_name: 'Organizer', profile_kind: 'organizer' },
      ] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/open-mics/STAGE/public-details', () => HttpResponse.json(seriesWithOwner)),
      http.get('/api/open-mics/STAGE/next-event', () => HttpResponse.json({
        current_event: null, current_registration_open: false,
        next_event: event, next_registration_event: event,
      })),
      http.get('/api/open-mics/open-mic-1/public-events', () => HttpResponse.json({
        items: [event], pagination: { page: 1, page_size: 10, total: 1 }, available_years: [],
      })),
      http.get('/api/open-mics/open-mic-1/media', () => HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })),
      http.get('/api/open-mics/open-mic-1/featured-media', () => HttpResponse.json({ items: [] })),
    )
    renderWithProviders(<DetailPage kind="open-mic" id="STAGE" theme="venue" mode="light" />)

    const copyActions = await screen.findAllByRole('link', { name: 'Copy Friday Stage' })
    expect(copyActions).toHaveLength(2)
    for (const copyAction of copyActions) {
      expect(copyAction).toHaveTextContent('Copy')
      expect(copyAction).toHaveAttribute('href', expect.stringContaining('/dashboard/series/open-mic-1/events/new?'))
      expect(copyAction).toHaveAttribute('href', expect.stringContaining('sourceEventId=event-1'))
      expect(copyAction).toHaveAttribute('href', expect.stringContaining('copySchedule=true'))
    }
  })
})