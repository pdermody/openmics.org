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
    expect(screen.queryByRole('link', { name: 'Create open mic series' })).not.toBeInTheDocument()
  })

  it.each(['empty', 'existing', 'error'] as const)('shows first-series creation only for a successful empty response: %s', async (state) => {
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
      http.get('/api/me/open-mics', () => state === 'error'
        ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Could not load series' } }, { status: 500 })
        : HttpResponse.json({ items: state === 'empty' ? [] : [{
          id: 'series-1', name: 'Existing series', status: 'draft', venue_name: 'The Venue', city: 'Dublin',
        }] })),
      http.get('/api/open-mics/series-1/events', () => HttpResponse.json([])),
      http.get('/api/me/claimable-registrations', () => HttpResponse.json([])),
    )

    renderWithProviders(<OrganizerDashboardPage theme="venue" mode="light" />)

    expect(await screen.findByText(/You are working as Organizer/)).toBeInTheDocument()
    if (state === 'empty') {
      expect(await screen.findByText('Set up your first open mic')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Create open mic series' }).closest('.dashboard-card')).not.toBeNull()
      expect(screen.getAllByRole('link', { name: 'Create open mic series' })).toHaveLength(1)
      expect(screen.getByRole('link', { name: 'Create open mic series' })).toHaveAttribute('href', '/dashboard/series/new')
    } else if (state === 'existing') {
      await screen.findByRole('link', { name: 'Existing series' })
      expect(screen.queryByText('Set up your first open mic')).not.toBeInTheDocument()
    } else {
      await screen.findByText('We could not load your open mic series.')
      expect(screen.queryByText('Set up your first open mic')).not.toBeInTheDocument()
    }
    if (state !== 'empty') expect(screen.queryByRole('link', { name: 'Create open mic series' })).not.toBeInTheDocument()
  })
})
