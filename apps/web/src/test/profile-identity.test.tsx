import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProfileIdentity } from '../components/ProfileIdentity'
import { ProfileManagementPage } from '../views/ProfileManagementPage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('ProfileIdentity', () => {
  it('shows the kind label and, in full mode, the handle', () => {
    render(<ProfileIdentity profile={{ profile_name: 'Paul Dermody', profile_kind: 'performer', current_handle: 'paul-dermody' }} variant="full" />)
    expect(screen.getByText('Paul Dermody')).toBeInTheDocument()
    expect(screen.getByText(/Performer/)).toHaveTextContent('Performer · @paul-dermody')
  })

  it('shows only the kind for organizers, which have no handle', () => {
    render(<ProfileIdentity profile={{ profile_name: 'Paul Dermody', profile_kind: 'organizer', current_handle: null }} variant="full" />)
    expect(screen.getByText('Organizer')).toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })
})

describe('profile deletion guards in Manage Profiles', () => {
  it('disables Delete on the current profile but not on others', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1', email: 'paul@example.test', display_name: 'Paul', city: null,
        preferred_language: 'en', current_profile_id: 'profile-org', is_platform_admin: false, plan: 'free',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [
        { id: 'profile-org', profile_name: 'Paul Dermody', profile_kind: 'organizer', current_handle: null, bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null },
        { id: 'profile-perf', profile_name: 'Paul Dermody', profile_kind: 'performer', current_handle: 'paul-dermody', bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null },
      ] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    )

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete profile' })).toHaveLength(2))
    const [organizerDelete, performerDelete] = screen.getAllByRole('button', { name: 'Delete profile' })
    expect(organizerDelete).toBeDisabled()
    expect(performerDelete).toBeEnabled()
    expect(screen.getByText('Switch to another profile before deleting this one.')).toBeInTheDocument()
  })
})
