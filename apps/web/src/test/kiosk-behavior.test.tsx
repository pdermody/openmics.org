import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { KioskPage } from '../views/KioskPage'
import { renderWithProviders } from './render'
import { server } from './server'

beforeEach(() => {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
})

afterEach(() => {
  window.localStorage.clear()
})

function registerOrganizerHandlers() {
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({
      id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
      preferred_language: null, current_profile_id: 'profile-1', is_platform_admin: false, plan: 'free',
    })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
      id: 'profile-1', profile_name: 'Stage Organizer', profile_kind: 'organizer', current_handle: null,
      bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null,
    }] })),
    http.get('/api/me/permissions', ({ request }) => {
      expect(new URL(request.url).searchParams.get('profile')).toBe('profile-1')
      return HttpResponse.json({ permissions: ['profiles:manage'] })
    }),
    http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
      id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
      running: false, registrations_closed_at: '2026-09-01T19:00:00.000Z', venue_name: 'The Lantern', city: 'Dublin',
    })),
    http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
  )
}

describe('KioskPage behavior', () => {
  it('requires a session PIN and then blocks sign-ups for a closed event', async () => {
    const user = userEvent.setup()
    registerOrganizerHandlers()
    const { container } = renderWithProviders(<KioskPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)

    await screen.findByRole('heading', { name: 'Choose this session\'s exit PIN' })
    const pinInputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]')
    expect(pinInputs).toHaveLength(2)
    await user.type(pinInputs[0], '1234')
    await user.type(pinInputs[1], '1234')
    await user.click(screen.getByRole('button', { name: 'Start kiosk mode' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Registration is closed for this event.')
    expect(screen.queryByRole('button', { name: 'Add to roster' })).not.toBeInTheDocument()
  })
})