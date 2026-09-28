import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProfileIdentity } from '../components/ProfileIdentity'
import { ProfileManagementPage } from '../views/ProfileManagementPage'
import { renderWithProviders } from './render'
import { server } from './server'

const ORGANIZER_PROFILE = { id: 'profile-org', profile_name: 'Paul Dermody', profile_kind: 'organizer', current_handle: null, bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null }
const PERFORMER_PROFILE = { id: 'profile-perf', profile_name: 'Paul Dermody', profile_kind: 'performer', current_handle: 'paul-dermody', bio: null, phone: null, visibility: 'public', theme_name: null, color_mode: null }

function mockAccount(profiles: object[], currentProfileId: string) {
  window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
  server.use(
    http.get('/api/me', () => HttpResponse.json({
      id: 'account-1', email: 'paul@example.test', display_name: 'Paul', city: null,
      preferred_language: 'en', current_profile_id: currentProfileId, is_platform_admin: false, plan: 'free',
    })),
    http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: profiles })),
    http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
    http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
  )
}

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
    mockAccount([ORGANIZER_PROFILE, PERFORMER_PROFILE], 'profile-org')

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete profile' })).toHaveLength(2))
    const [organizerDelete, performerDelete] = screen.getAllByRole('button', { name: 'Delete profile' })
    expect(organizerDelete).toBeDisabled()
    expect(performerDelete).toBeEnabled()
    expect(screen.getByText('Switch to another profile before deleting this one.')).toBeInTheDocument()
  })

  it('keeps Confirm disabled until the exact profile name is typed', async () => {
    mockAccount([ORGANIZER_PROFILE, PERFORMER_PROFILE], 'profile-org')

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete profile' })).toHaveLength(2))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete profile' })[1])

    const confirm = await screen.findByRole('button', { name: 'Confirm' })
    expect(confirm).toBeDisabled()
    const input = screen.getByLabelText(/Type Paul Dermody to confirm/)
    await userEvent.type(input, 'paul dermody')
    expect(confirm).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, 'Paul Dermody')
    expect(confirm).toBeEnabled()
  })

  it('warns that open mics and events go with an organizer profile', async () => {
    mockAccount([ORGANIZER_PROFILE, PERFORMER_PROFILE], 'profile-perf')

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete profile' })).toHaveLength(2))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete profile' })[0])

    expect(await screen.findByText(/removes every open mic series it owns/)).toBeInTheDocument()
  })
})

describe('organizer profile limit in Manage Profiles', () => {
  it('disables the Organizer option when the account already has one', async () => {
    mockAccount([ORGANIZER_PROFILE, PERFORMER_PROFILE], 'profile-perf')

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Organizer' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Performer' })).toBeEnabled()
    expect(screen.getByText('You already have an organizer profile. Each account can have only one.')).toBeInTheDocument()
  })

  it('allows the Organizer option when the account has none', async () => {
    mockAccount([PERFORMER_PROFILE], 'profile-perf')

    renderWithProviders(<ProfileManagementPage theme="venue" mode="light" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Organizer' })).toBeEnabled())
  })
})
