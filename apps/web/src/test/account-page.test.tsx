import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountPage } from '../views/AccountPage'
import { renderWithProviders } from './render'
import { server } from './server'

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
