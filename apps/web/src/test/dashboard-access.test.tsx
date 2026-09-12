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

    expect(await screen.findByRole('status')).toHaveTextContent('Sign in to open your dashboard.')
    expect(screen.queryByRole('link', { name: 'Manage series' })).not.toBeInTheDocument()
  })
})