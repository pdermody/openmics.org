import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { waitFor, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegistrationPage } from '../views/RegistrationPage'
import type { Event } from '../features/publicReads'
import { renderWithProviders } from './render'
import { server } from './server'
import { dublinCity } from './city-fixtures'

const event: Event = {
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
  status: 'published' as const,
  phase: 'future' as const,
  notes: null,
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

function registerReadHandlers(currentEvent = event) {
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
    http.get('/api/events/LIVE1', () => HttpResponse.json(currentEvent)),
    http.get('/api/open-mics/open-mic-1', () => HttpResponse.json(openMic)),
  )
}

describe('RegistrationPage', () => {
  it('clears a guest-edit city without changing registration provenance', async () => {
    const user = userEvent.setup()
    let patch: Record<string, unknown> | undefined
    window.localStorage.setItem('openmic_edit_registration_id_LIVE1', 'registration-1')
    registerReadHandlers()
    server.use(
      http.get('/api/cities/city-dublin', () => HttpResponse.json(dublinCity)),
      http.get('/api/registrations/registration-1', () => HttpResponse.json({
        id: 'registration-1', event_id: 'event-1', performer_name: 'Guest Ava', performer_city: 'Dublin',
        performer_city_id: dublinCity.id, contact_phone: null, song_names: [], media_consent: true, email_verified_at: null,
      })),
      http.patch('/api/registrations/registration-1', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>
        return HttpResponse.json({ id: 'registration-1', ...patch })
      }),
    )
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)
    expect(await screen.findByText('Dublin, Ireland')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear city' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patch).toMatchObject({ performer_city: null, performer_city_id: null }))
    expect(patch).not.toHaveProperty('submission_channel')
    expect(patch).not.toHaveProperty('profile_id')
    expect(patch).not.toHaveProperty('organizer_supervised')
  })

  it('shows the closed state and does not render a guest form', async () => {
    registerReadHandlers({ ...event, registrations_closed_at: '2026-09-01T19:00:00.000Z' })
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    expect(await screen.findByRole('heading', { name: 'Join Friday Stage' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Registration is closed for this event.')
    expect(screen.queryByRole('button', { name: /submit registration/i })).not.toBeInTheDocument()
  })

  it('submits a valid guest registration and shows the confirmation state', async () => {
    const user = userEvent.setup()
    let submitted: Record<string, unknown> | undefined
    registerReadHandlers()
    server.use(http.get('/api/cities/search', () => HttpResponse.json({ items: [dublinCity] })), http.post('/api/events/LIVE1/registrations', async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>
      return HttpResponse.json({ id: 'registration-1', event_id: 'event-1' }, { status: 201 })
    }))
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    await user.type(await screen.findByLabelText(/performer name/i), 'Ava Quinn')
    await user.type(screen.getByLabelText(/contact email/i), 'ava@example.test')
    await user.type(screen.getByRole('combobox', { name: 'City' }), 'Dub')
    await user.click(await screen.findByRole('option'))
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox to confirm your registration.')
    await waitFor(() => expect(submitted).toMatchObject({
      performer_name: 'Ava Quinn',
      performer_city: 'Dublin',
      performer_city_id: dublinCity.id,
      contact_email: 'ava@example.test',
      organizer_supervised: false,
      submission_channel: 'organic',
    }))
  })

  it('shows an unavailable state without a guest form after the event has ended', async () => {
    registerReadHandlers({ ...event, phase: 'past' })
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Registration is no longer available for this event.')
    expect(screen.queryByRole('button', { name: /submit registration/i })).not.toBeInTheDocument()
  })

  it('accepts an email-less phone sign-up with a kiosk token for an on-the-night-only series', async () => {
    const user = userEvent.setup()
    let submitted: Record<string, unknown> | undefined
    let requestedEventUrl = ''
    window.history.replaceState({}, '', '/events/LIVE1/register?kiosk=presence-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
      http.get('/api/events/LIVE1', ({ request }) => { requestedEventUrl = request.url; return HttpResponse.json({ ...event, registrations_closed_at: '2026-09-01T19:00:00.000Z' }) }),
      http.get('/api/open-mics/open-mic-1', () => HttpResponse.json({ ...openMic, registration_mode: 'on_night_only' })),
      http.get('/api/cities/search', () => HttpResponse.json({ items: [dublinCity] })),
      http.post('/api/events/LIVE1/registrations', async ({ request }) => {
        submitted = await request.json() as Record<string, unknown>
        return HttpResponse.json({ id: 'registration-1', event_id: 'event-1' }, { status: 201 })
      }),
    )
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    expect(window.location.search).toBe('')
    await user.type(await screen.findByLabelText(/performer name/i), 'Walk In')
    await user.type(screen.getByRole('combobox', { name: 'City' }), 'Dub')
    await user.click(await screen.findByRole('option'))
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('You’re on the list!')
    expect(new URL(requestedEventUrl).searchParams.get('kiosk_token')).toBe('presence-token')
    expect(submitted).toMatchObject({ performer_name: 'Walk In', performer_city: 'Dublin', performer_city_id: dublinCity.id, submission_channel: 'kiosk_qr', kiosk_token: 'presence-token', organizer_supervised: false })
    expect(submitted).not.toHaveProperty('contact_email')
  })

  it('explains an expired kiosk QR code', async () => {
    const user = userEvent.setup()
    window.sessionStorage.setItem('openmic_kiosk_token_LIVE1', 'expired-token')
    registerReadHandlers()
    server.use(http.post('/api/events/LIVE1/registrations', () => HttpResponse.json({ error: { code: 'KIOSK_TOKEN_INVALID', message: 'expired' } }, { status: 403 })))
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    await user.type(await screen.findByLabelText(/performer name/i), 'Late Scan')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This QR code has expired')
  })
})