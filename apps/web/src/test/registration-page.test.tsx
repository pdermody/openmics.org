import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { waitFor, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegistrationPage } from '../views/RegistrationPage'
import { renderWithProviders } from './render'
import { server } from './server'

const event = {
  id: 'event-1',
  public_code: 'LIVE1',
  open_mic_id: 'open-mic-1',
  title: 'Friday Stage',
  starts_at: '2026-10-01T19:00:00.000Z',
  time_zone: 'Europe/Dublin',
  venue_name: 'The Lantern',
  city: 'Dublin',
  country: 'IE',
  activities: ['singing'],
  tags: [],
  capacity: null,
  registrations_closed_at: null as string | null,
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
    server.use(http.post('/api/events/LIVE1/registrations', async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>
      return HttpResponse.json({ id: 'registration-1', event_id: 'event-1' }, { status: 201 })
    }))
    renderWithProviders(<RegistrationPage eventCode="LIVE1" theme="venue" mode="light" />)

    await user.type(await screen.findByLabelText(/performer name/i), 'Ava Quinn')
    await user.type(screen.getByLabelText(/contact email/i), 'ava@example.test')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox to confirm your registration.')
    await waitFor(() => expect(submitted).toMatchObject({
      performer_name: 'Ava Quinn',
      contact_email: 'ava@example.test',
      organizer_supervised: false,
      submission_channel: 'organic',
    }))
  })
})