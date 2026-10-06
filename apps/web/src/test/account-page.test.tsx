import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountPage } from '../views/AccountPage'
import { renderWithProviders } from './render'
import { server } from './server'
import { dublinCity } from './city-fixtures'

function mockGeolocationPermission(state: PermissionState) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state, addEventListener: () => undefined }) },
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: () => undefined },
  })
}

afterEach(() => {
  delete (navigator as unknown as { permissions?: unknown }).permissions
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
  window.localStorage.clear()
})

describe('AccountPage', () => {
  it('saves a selected city identity and explicitly clears both city text and reference', async () => {
    const user = userEvent.setup()
    mockGeolocationPermission('prompt')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    const account = { id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null, city_id: null, preferred_language: 'en', current_profile_id: null, is_platform_admin: false, plan: 'free' }
    let patch: Record<string, unknown> | undefined
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json(account)),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
      http.get('/api/cities/search', () => HttpResponse.json({ items: [dublinCity] })),
      http.patch('/api/accounts/account-1', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...account, ...patch })
      }),
    )
    renderWithProviders(<AccountPage theme="venue" mode="light" />)
    await screen.findByDisplayValue('Organizer')
    await user.type(screen.getByRole('combobox', { name: 'City' }), 'Dub')
    await user.click(await screen.findByRole('option'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patch).toMatchObject({ city: 'Dublin', city_id: dublinCity.id }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Clear city' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patch).toMatchObject({ city: null, city_id: null }))
  })

  it('shows the signed-in account details and saves edits', async () => {
    const user = userEvent.setup()
    let accountPatch: Record<string, unknown> | undefined
    mockGeolocationPermission('prompt')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')

    server.use(
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1',
        email: 'organizer@example.test',
        display_name: 'Organizer',
        city: 'Dublin',
        preferred_language: 'en',
        current_profile_id: null,
        is_platform_admin: false,
        plan: 'free',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
      http.patch('/api/accounts/account-1', async ({ request }) => {
        accountPatch = await request.json() as Record<string, unknown>
        return HttpResponse.json({
          id: 'account-1',
          email: 'organizer@example.test',
          display_name: accountPatch.display_name,
          city: accountPatch.city,
          preferred_language: accountPatch.preferred_language,
          current_profile_id: null,
          is_platform_admin: false,
          plan: 'free',
        })
      }),
    )

    renderWithProviders(<AccountPage theme="venue" mode="light" />)

    expect(await screen.findByDisplayValue('Organizer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Dublin')).toBeInTheDocument()
    expect(screen.getByDisplayValue('organizer@example.test')).toBeInTheDocument()
    expect(screen.getByText(/your saved city helps us find open mics nearby/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enable browser location/i })).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Display name'))
    await user.type(screen.getByLabelText('Display name'), 'Updated Organizer')
    await user.clear(screen.getByLabelText('City'))
    await user.type(screen.getByLabelText('City'), 'Cork')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(accountPatch).toEqual({
      display_name: 'Updated Organizer',
      city: 'Cork',
      city_id: null,
      preferred_language: 'en',
    }))
  })

  it('explains that location is blocked instead of showing a dead-end button', async () => {
    mockGeolocationPermission('denied')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')

    server.use(
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1',
        email: 'organizer@example.test',
        display_name: 'Organizer',
        city: 'Dublin',
        preferred_language: 'en',
        current_profile_id: null,
        is_platform_admin: false,
        plan: 'free',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
    )

    renderWithProviders(<AccountPage theme="venue" mode="light" />)

    expect(await screen.findByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText(/location access is blocked in your browser or device settings/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enable browser location/i })).not.toBeInTheDocument()
  })
})
