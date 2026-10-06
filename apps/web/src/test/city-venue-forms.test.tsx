import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenMicFormPage } from '../views/OpenMicFormPage'
import { EventFormPage } from '../views/EventFormPage'
import type { LocationPickerProps } from '../components/location/LocationPicker'
import { renderWithProviders } from './render'
import { server } from './server'

vi.mock('../components/location/LocationPicker', () => ({
  LocationPicker: ({ lat, lng, provisional, onConfirm, onChange }: LocationPickerProps) => <div>
    <output aria-label="Venue coordinates">{lat}, {lng}</output>
    {provisional && <button type="button" onClick={onConfirm}>Confirm venue location</button>}
    <button type="button" onClick={() => onChange({ lat: 51.9, lng: -8.4 })}>Refine venue pin</button>
  </div>,
}))

const city = {
  id: 'city-cork', city: 'Cork', city_ascii: 'Cork', country: 'Ireland', country_ascii: 'Ireland',
  iso2: 'IE', iso3: 'IRL', admin_name: 'Cork', lat: 51.89, lng: -8.47, population: 220000, retired: false,
}
const series = {
  id: 'series-1', owner_profile_id: 'profile-1', name: 'Friday Open Mic', description: null,
  venue_name: 'The Lantern', address_line1: '1 Main St', address_line2: null, postcode: null,
  city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26, time_zone: 'Europe/Dublin',
  originals_only: false, amplification_available: false, age_policy: 'both',
  activities: ['singing'], tags: [], registration_mode: 'both', status: 'active',
}
const event = {
  id: 'event-1', public_code: 'LIVE1', title: 'Friday Stage', starts_at: '2026-10-01T19:00:00.000Z',
  ends_at: '2026-10-01T22:00:00.000Z', time_zone: 'Europe/Dublin', status: 'published',
  phase: 'future', registrations_closed_at: null, capacity: 20, venue_name: 'The Lantern',
  address_line1: '1 Main St', city: 'Dublin', country: 'IE', lat: 53.35, lng: -6.26,
  activities: ['singing'], tags: [],
}

function mockForms(savedCity = false) {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
  server.use(
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    http.get('/api/me', () => HttpResponse.json({ id: 'account-1', current_profile_id: 'profile-1' })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{ id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer' }] })),
    http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
    http.get('/api/open-mics/series-1', () => HttpResponse.json({ ...series, ...(savedCity ? { city_id: city.id, city: city.city } : {}) })),
    http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
    http.get('/api/open-mics/series-1/events/event-1', () => HttpResponse.json({ ...event, ...(savedCity ? { city_id: city.id, city: city.city } : {}) })),
    http.get('/api/cities/search', () => HttpResponse.json({ items: [city] })),
    http.get('/api/cities/city-cork', () => HttpResponse.json(city)),
  )
}

async function selectCork() {
  const input = screen.getByRole('combobox', { name: /city/i })
  fireEvent.change(input, { target: { value: 'Cor' } })
  const picker = input.closest('.city-picker') as HTMLElement
  fireEvent.click(await within(picker).findByRole('option', { name: /Cork/ }))
}

describe('City references and venue pin confirmation', () => {
  it.each(['series', 'event'] as const)('requires confirmation of a selected city centre before saving %s', async (kind) => {
    mockForms()
    let submitted: Record<string, unknown> | undefined
    const endpoint = kind === 'series' ? '/api/open-mics/series-1' : '/api/events/event-1'
    server.use(http.patch(endpoint, async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ...(kind === 'series' ? series : event), ...submitted })
    }))
    renderWithProviders(kind === 'series'
      ? <OpenMicFormPage seriesId="series-1" theme="venue" mode="light" />
      : <EventFormPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)
    await screen.findByDisplayValue(kind === 'series' ? series.name : event.title)
    fireEvent.click(screen.getByRole('tab', { name: 'Location' }))
    await selectCork()
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /country/i })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Venue coordinates')).toHaveTextContent('51.89, -8.47')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm or refine the venue pin before saving.')
    expect(submitted).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm venue location' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(submitted).toMatchObject({ city: 'Cork', city_id: city.id, country: 'IE', lat: city.lat, lng: city.lng }))
  })

  it('refining a city-centre pin confirms it, and editing free text clears the reference', async () => {
    mockForms()
    let submitted: Record<string, unknown> | undefined
    server.use(http.patch('/api/open-mics/series-1', async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ...series, ...submitted })
    }))
    renderWithProviders(<OpenMicFormPage seriesId="series-1" theme="venue" mode="light" />)
    await screen.findByDisplayValue(series.name)
    fireEvent.click(screen.getByRole('tab', { name: 'Location' }))
    await selectCork()
    fireEvent.click(screen.getByRole('button', { name: 'Refine venue pin' }))
    expect(screen.queryByRole('button', { name: 'Confirm venue location' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: /city/i }), { target: { value: 'Cork outskirts' } })
    expect(screen.getByRole('combobox', { name: /country/i })).toHaveValue('IE')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(submitted).toMatchObject({ city: 'Cork outskirts', city_id: null, lat: 51.9, lng: -8.4 }))
  })

  it.each(['series', 'event'] as const)('resolves a saved %s city without overwriting the venue coordinates', async (kind) => {
    mockForms(true)
    renderWithProviders(kind === 'series'
      ? <OpenMicFormPage seriesId="series-1" theme="venue" mode="light" />
      : <EventFormPage seriesId="series-1" eventId="event-1" theme="venue" mode="light" />)
    await screen.findByDisplayValue(kind === 'series' ? series.name : event.title)
    fireEvent.click(screen.getByRole('tab', { name: 'Location' }))
    expect(await screen.findByText('Cork, Ireland')).toBeInTheDocument()
    expect(screen.getByLabelText('Venue coordinates')).toHaveTextContent('53.35, -6.26')
    expect(screen.queryByRole('button', { name: 'Confirm venue location' })).not.toBeInTheDocument()
  })
})
