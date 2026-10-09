import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventFormPage } from '../views/EventFormPage'
import type { Event } from '../features/publicReads'
import { renderWithProviders } from './render'
import { server } from './server'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../components/location/LocationPicker', () => ({ LocationPicker: () => null }))

const sourceDetail = {
  id: 'source-1',
  open_mic_id: 'series-1',
  title: 'Friday Showcase',
  starts_at: '2026-10-10T18:00:00.000Z',
  ends_at: '2026-10-10T21:00:00.000Z',
  time_zone: 'Europe/Dublin',
  status: 'published' as const,
  phase: 'future' as const,
  registrations_closed_at: '2026-10-09T12:00:00.000Z',
  capacity: 24,
  venue_name: 'The Lantern',
  address_line1: '1 Main St',
  address_line2: null,
  postcode: null,
  city: 'Dublin',
  city_id: null,
  country: 'IE',
  lat: 53.35,
  lng: -6.26,
  activities: ['singing'],
  tags: ['acoustic'],
  notes: 'Doors open early',
  entry_fee_amount: 5,
  entry_fee_currency: 'EUR',
  entry_fee_note: 'Cash only',
}

function makeListedEvent(id: string, startsAt: string): Event {
  return {
    id,
    public_code: id,
    open_mic_id: 'series-1',
    title: `Show ${id}`,
    starts_at: startsAt,
    ends_at: null,
    time_zone: 'Europe/Dublin',
    venue_name: 'The Lantern',
    city: 'Dublin',
    country: 'IE',
    activities: ['singing'],
    tags: [],
    capacity: null,
    registrations_closed_at: null,
    status: 'published',
    phase: new Date(startsAt).getTime() < Date.now() ? 'past' : 'future',
    notes: null,
  }
}

function mockEventCreate(events: Event[] = [], source = sourceDetail) {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({
      id: 'account-1', email: 'organizer@example.test', current_profile_id: 'profile-1',
    })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
      id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer',
    }] })),
    http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
    http.get('/api/open-mics/series-1', () => HttpResponse.json({
      id: 'series-1', owner_profile_id: 'profile-1', name: 'Open Mic', registration_mode: 'both',
      time_zone: 'Europe/Dublin', activities: ['singing'], venue_name: 'The Lantern',
      address_line1: '1 Main St', city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26,
    })),
    http.get('/api/open-mics/series-1/events', () => HttpResponse.json(events)),
    http.get('/api/open-mics/series-1/events/source-1', () => HttpResponse.json(source)),
  )
}

describe('event copy creation', () => {
  it('defaults to a three-hour duration and keeps the current duration when start changes', async () => {
    mockEventCreate()
    const { container } = renderWithProviders(<EventFormPage seriesId="series-1" theme="venue" mode="light" />)
    const start = await screen.findByLabelText(/Starts at/)
    const end = screen.getByLabelText(/Ends at/)
    expect(await screen.findByText('No past or upcoming events are available to copy.')).toBeInTheDocument()

    fireEvent.change(start, { target: { value: '2026-10-10T18:00' } })
    expect(end).toHaveValue('2026-10-10T21:00')
    fireEvent.change(end, { target: { value: '2026-10-10T22:30' } })
    fireEvent.change(start, { target: { value: '2026-10-10T19:00' } })
    expect(end).toHaveValue('2026-10-10T23:30')
    expect(container.querySelector('select[disabled]')).toHaveValue('draft')
  })

  it('shows at most ten recent/upcoming source events in the optional selector', async () => {
    const events = Array.from({ length: 14 }, (_, index) => makeListedEvent(
      `event-${index}`,
      new Date(Date.now() + (index < 7 ? index - 7 : index - 6) * 24 * 60 * 60 * 1000).toISOString(),
    ))
    mockEventCreate(events)
    renderWithProviders(<EventFormPage seriesId="series-1" theme="venue" mode="light" />)
    const selector = await screen.findByLabelText('Copy settings from an event (optional)')
    await waitFor(() => expect(selector.querySelectorAll('option')).toHaveLength(11))
    expect(selector.querySelectorAll('option')).toHaveLength(11)
    const listedIds = [...selector.querySelectorAll('option')].slice(1).map((option) => option.getAttribute('value'))
    expect(listedIds.filter((id) => id && Number(id.split('-')[1]) >= 7)).toHaveLength(5)
    expect(listedIds.filter((id) => id && Number(id.split('-')[1]) < 7)).toHaveLength(5)
  })

  it('copies editable details but resets publication and registration state', async () => {
    const events = [makeListedEvent('source-1', sourceDetail.starts_at)]
    mockEventCreate(events)
    renderWithProviders(<EventFormPage seriesId="series-1" theme="venue" mode="light" />)
    const sourceOption = await screen.findByRole('option', { name: /Show source-1/ })
    fireEvent.change(screen.getByLabelText('Copy settings from an event (optional)'), { target: { value: sourceOption.getAttribute('value') } })

    expect(await screen.findByDisplayValue('Friday Showcase')).toBeInTheDocument()
    expect(screen.getByLabelText(/Starts at/)).toHaveValue('2026-10-10T19:00')
    expect(screen.getByLabelText(/Ends at/)).toHaveValue('2026-10-10T22:00')
    expect(screen.getByLabelText(/Capacity/)).toHaveValue(24)
    expect(screen.getByLabelText(/Capacity/).closest('label')?.querySelector('.required-mark')).toHaveTextContent('*')
    expect(screen.getByLabelText('Publication')).toHaveValue('draft')
    expect(screen.queryByLabelText('Registrations close at')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Copy settings from an event (optional)')).toHaveValue('source-1')
  })

  it('lets a direct copy change its date using Starts at without a separate date field', async () => {
    mockEventCreate()
    renderWithProviders(<EventFormPage seriesId="series-1" sourceEventId="source-1" copySchedule theme="venue" mode="light" />)
    await screen.findByDisplayValue('Friday Showcase')
    const start = screen.getByLabelText(/Starts at/)
    const end = screen.getByLabelText(/Ends at/)
    expect(screen.queryByLabelText(/New event date/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Copy settings from an event (optional)')).toHaveValue('source-1')
    expect(start).toHaveValue('2026-10-10T19:00')
    expect(end).toHaveValue('2026-10-10T22:00')
    fireEvent.change(start, { target: { value: '2026-10-17T19:00' } })

    await waitFor(() => {
      expect(start).toHaveValue('2026-10-17T19:00')
      expect(end).toHaveValue('2026-10-17T22:00')
    })
    fireEvent.change(start, { target: { value: '2026-10-17T20:30' } })
    expect(start).toHaveValue('2026-10-17T20:30')
    expect(end).toHaveValue('2026-10-17T23:30')
    fireEvent.change(end, { target: { value: '2026-10-18T00:30' } })
    expect(end).toHaveValue('2026-10-18T00:30')
    expect(screen.getByLabelText(/Starts at/).closest('label')?.querySelector('.required-mark')?.textContent).toBe('\u00a0*')
  })

  it.each([true, false])('saves a copied overnight schedule without date confirmation (direct copy: %s)', async (copySchedule) => {
    const source = {
      ...sourceDetail,
      starts_at: '2026-10-10T22:00:00.000Z',
      ends_at: '2026-10-11T01:00:00.000Z',
    }
    mockEventCreate([makeListedEvent('source-1', source.starts_at)], source)
    const create = vi.fn()
    server.use(http.post('/api/open-mics/series-1/events', async ({ request }) => {
      create(await request.json())
      return HttpResponse.json({ ...source, id: 'created-1', public_code: 'NEW1', status: 'draft' })
    }))
    const { container } = renderWithProviders(<EventFormPage seriesId="series-1" sourceEventId="source-1" copySchedule={copySchedule} theme="venue" mode="light" />)
    await screen.findByDisplayValue('Friday Showcase')
    expect(screen.queryByLabelText(/New event date/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Starts at/), { target: { value: '2026-10-17T23:00' } })
    expect(screen.getByLabelText(/Ends at/)).toHaveValue('2026-10-18T02:00')
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      starts_at: '2026-10-17T22:00:00.000Z',
      ends_at: '2026-10-18T01:00:00.000Z',
      time_zone: 'Europe/Dublin',
      status: 'draft',
    })))
    expect(create.mock.calls[0][0]).not.toHaveProperty('copy_date')
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({
      to: '/events/$eventId',
      params: { eventId: 'NEW1' },
    }))
  })

  it.each([
    {
      source: { ...sourceDetail, starts_at: '2026-10-24T00:30:00.000Z', ends_at: '2026-10-24T01:30:00.000Z' },
      start: '2026-10-25T01:30',
      error: 'This local time occurs twice because of a daylight-saving change. Choose another time.',
    },
    {
      source: { ...sourceDetail, starts_at: '2026-03-28T01:30:00.000Z', ends_at: '2026-03-28T02:30:00.000Z' },
      start: '2026-03-29T01:30',
      error: 'This local time does not exist because of a daylight-saving change. Choose another time.',
    },
  ])('requires another start time when a copied local time is invalid at a daylight-saving transition', async ({ source, start, error }) => {
    mockEventCreate([makeListedEvent('source-1', source.starts_at)], source)
    renderWithProviders(<EventFormPage seriesId="series-1" sourceEventId="source-1" copySchedule theme="venue" mode="light" />)
    await screen.findByDisplayValue('Friday Showcase')
    fireEvent.change(screen.getByLabelText(/Starts at/), { target: { value: start } })

    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(screen.getByLabelText(/Starts at/)).toHaveValue(start)
  })
})
