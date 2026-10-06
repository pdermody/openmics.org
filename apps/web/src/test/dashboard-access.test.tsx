import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrganizerDashboardPage } from '../views/OrganizerDashboardPage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('OrganizerDashboardPage access states', () => {
  it('asks anonymous visitors to sign in', async () => {
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })),
    )

    renderWithProviders(<OrganizerDashboardPage theme="venue" mode="light" />)

    expect(await screen.findByText('Sign in to open your dashboard.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage series' })).not.toBeInTheDocument()
  })

  it('hides the create-series action when the account already has an organizer profile', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1',
        current_profile_id: 'profile-1',
        is_platform_admin: false,
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({
        items: [{ id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer' }],
      })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/me/open-mics', () => HttpResponse.json({ items: [] })),
      http.get('/api/me/claimable-registrations', () => HttpResponse.json([])),
    )

    renderWithProviders(<OrganizerDashboardPage theme="venue" mode="light" />)

    expect(await screen.findByText(/You are working as Organizer/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create open mic series' })).not.toBeInTheDocument()
  })
})
