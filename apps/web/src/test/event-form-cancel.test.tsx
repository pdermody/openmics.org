import { http, HttpResponse } from 'msw'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventFormPage } from '../views/EventFormPage'
import { renderWithProviders } from './render'
import { server } from './server'

vi.mock('../components/location/LocationPicker', () => ({ LocationPicker: () => null }))

function mockOrganizerEventForm(registrationMode: 'pre_only' | 'on_night_only' | 'both' | 'external', isEdit = false) {
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
      id: 'series-1', owner_profile_id: 'profile-1', name: 'Open Mic', registration_mode: registrationMode,
      time_zone: 'Europe/Dublin', activities: ['singing'], venue_name: 'The Lantern',
      address_line1: '1 Main St', city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26,
    })),
    ...(isEdit ? [http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({
      id: 'event-1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
      ends_at: '2026-10-01T22:00:00.000Z', time_zone: 'Europe/Dublin', status: 'published',
      phase: 'future', registrations_closed_at: null, capacity: null, venue_name: 'The Lantern',
      address_line1: '1 Main St', city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26,
      activities: ['singing'], tags: [],
    }))] : []),
  )
}

describe('EventFormPage cancellation', () => {
  it('opens the app confirmation modal for unsaved edits without using the browser confirm dialog', async () => {
    mockOrganizerEventForm('both', true)
    const browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderWithProviders(<EventFormPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)
    // The form renders before its effect resets it to the loaded event; editing earlier gets overwritten.
    const title = await screen.findByDisplayValue('Friday Stage')
    fireEvent.change(title, { target: { value: 'Saturday Stage' } })
    expect(title).toHaveValue('Saturday Stage')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('dialog', { name: 'Confirm action' })).toHaveTextContent('Discard all unsaved changes and leave this form?')
    expect(browserConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog', { name: 'Confirm action' }).querySelector('.link-button')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(title).toHaveValue('Saturday Stage')
  })

  it('does not show registration controls when creating an event', async () => {
    mockOrganizerEventForm('both')

    renderWithProviders(<EventFormPage seriesId="series-1" theme="venue" mode="light" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Schedule' }))

    expect(screen.queryByLabelText('Registrations close at')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Open registrations when this event is created' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop registrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen registrations' })).not.toBeInTheDocument()
  })

  it.each(['on_night_only', 'external'] as const)('hides registration controls when editing a %s series event', async (registrationMode) => {
    mockOrganizerEventForm(registrationMode, true)

    renderWithProviders(<EventFormPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Schedule' }))

    expect(screen.queryByLabelText('Registrations close at')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop registrations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen registrations' })).not.toBeInTheDocument()
  })

  it.each(['pre_only', 'both'] as const)('shows registration controls when editing a %s series event', async (registrationMode) => {
    mockOrganizerEventForm(registrationMode, true)

    renderWithProviders(<EventFormPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Schedule' }))

    expect(screen.getByLabelText('Registrations close at')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop registrations' })).toBeInTheDocument()
  })
})