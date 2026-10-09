import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizerDashboardPage } from '../views/OrganizerDashboardPage'
import { OrganizerEventsPage } from '../views/OrganizerEventsPage'
import { renderWithProviders } from './render'
import { server } from './server'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const event = {
  id: 'event-1',
  public_code: 'showcase',
  open_mic_id: 'series-1',
  title: 'Friday Showcase',
  starts_at: '2030-06-01T18:00:00.000Z',
  ends_at: '2030-06-01T21:00:00.000Z',
  time_zone: 'Europe/Dublin',
  venue_name: 'The Lantern',
  city: 'Dublin',
  country: 'IE',
  activities: ['singing'],
  tags: [],
  capacity: null,
  registrations_closed_at: null,
  status: 'published',
  phase: 'future',
  notes: null,
}

const openMic = {
  id: 'series-1',
  public_code: 'open-mic',
  owner_profile_id: 'profile-1',
  current_handle: null,
  name: 'Open Mic',
  description: null,
  venue_name: 'The Lantern',
  city: 'Dublin',
  country: 'IE',
  activities: ['singing'],
  tags: [],
  registration_mode: 'both',
  external_registration_url: null,
  status: 'active',
}

function mockDashboard() {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({
      id: 'account-1',
      current_profile_id: 'profile-1',
    })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({
      items: [{ id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer' }],
    })),
    http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
    http.get('/api/me/open-mics', () => HttpResponse.json({ items: [openMic] })),
    http.get('/api/me/claimable-registrations', () => HttpResponse.json([])),
    http.get('/api/open-mics/series-1/events', () => HttpResponse.json([event])),
    http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: false })),
  )
}

beforeEach(() => {
  navigateMock.mockClear()
})

describe('dashboard event copy action', () => {
  it.each([
    ['main dashboard', <OrganizerDashboardPage key="main-dashboard" theme="venue" mode="light" />],
    ['series dashboard', <OrganizerEventsPage key="series-dashboard" seriesId="series-1" theme="venue" mode="light" />],
  ])('opens the copy form from the %s event menu', async (_page, page) => {
    mockDashboard()
    renderWithProviders(page)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Event actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy Friday Showcase' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/dashboard/series/$seriesId/events/new',
      params: { seriesId: 'series-1' },
      search: { sourceEventId: 'event-1', copySchedule: true },
    })
  })
})
