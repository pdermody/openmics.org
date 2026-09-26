import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DurableRegistrationPage } from '../views/DurableRegistrationPage'
import type { Event } from '../features/publicReads'
import { renderWithProviders } from './render'
import { server } from './server'

const futureEvent: Event = {
  id: 'future-event', public_code: 'FUTURE1234', open_mic_id: 'series-1', title: 'Next Friday',
  starts_at: '2026-10-09T19:00:00.000Z', ends_at: '2026-10-09T22:00:00.000Z', time_zone: 'Europe/Dublin',
  venue_name: 'The Lantern', city: 'Dublin', country: 'IE', activities: ['singing'], tags: [], capacity: null,
  registrations_closed_at: null, status: 'published' as const, phase: 'future' as const, notes: null,
}

function renderResolution(currentEvent: Event | null, currentRegistrationOpen: boolean, nextEvent: Event | null, nextRegistrationEvent: Event | null) {
  server.use(http.get('/api/open-mics/series-1/next-event', () => HttpResponse.json({ current_event: currentEvent, current_registration_open: currentRegistrationOpen, next_event: nextEvent, next_registration_event: nextRegistrationEvent })))
  renderWithProviders(<DurableRegistrationPage openMicId="series-1" theme="venue" mode="light" />)
}

describe('DurableRegistrationPage', () => {
  it('explains an open running event before offering its registration link', async () => {
    renderResolution({ ...futureEvent, id: 'current-event', title: 'Tonight', phase: 'running' }, true, futureEvent, futureEvent)
    expect(await screen.findByRole('heading', { name: 'The event is underway' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register for this event' })).toHaveAttribute('href', '/events/current-event/register')
  })

  it('explains a closed running event and offers the next eligible event', async () => {
    renderResolution({ ...futureEvent, id: 'current-event', title: 'Tonight', phase: 'running', registrations_closed_at: '2026-10-01T20:00:00.000Z' }, false, futureEvent, futureEvent)
    expect(await screen.findByRole('heading', { name: 'Registration is unavailable for the current event' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register for Next Friday' })).toHaveAttribute('href', '/events/future-event/register')
  })

  it('offers the next eligible event when none is currently running', async () => {
    renderResolution(null, false, futureEvent, futureEvent)
    expect(await screen.findByRole('heading', { name: 'Register for the next event' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register for Next Friday' })).toBeInTheDocument()
  })

  it('shows no upcoming state when there is no registration target', async () => {
    renderResolution(null, false, null, null)
    expect(await screen.findByText('No upcoming rooms found near you yet.')).toBeInTheDocument()
  })

  it('explains a closed next event before offering a later eligible event', async () => {
    const closedNextEvent = { ...futureEvent, id: 'closed-event', title: 'This Friday', registrations_closed_at: '2026-10-01T20:00:00.000Z' }
    renderResolution(null, false, closedNextEvent, futureEvent)
    expect(await screen.findByRole('heading', { name: 'Registration is unavailable for the next event' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register for Next Friday' })).toBeInTheDocument()
  })
})