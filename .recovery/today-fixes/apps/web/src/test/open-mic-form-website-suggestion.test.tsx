import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenMicFormPage } from '../views/OpenMicFormPage'
import { renderWithProviders } from './render'
import { server } from './server'

vi.mock('../components/location/LocationPicker', () => ({ LocationPicker: () => null }))
vi.mock('../views/KioskBackupPin', () => ({ KioskBackupPinSection: () => null }))

// Regression coverage for the suggested Website field freezing at the first handle character.
// Root cause: the sync effect guarded on dirtyFields.website, but once the Cancel button reads
// formState.isDirty, react-hook-form recomputes dirtyFields by value-comparing every field
// against its default on each user keystroke — marking the programmatically-suggested website
// dirty and freezing the suggestion. The guard now uses a ref set by the field's own onChange.
describe('OpenMicFormPage website suggestion', () => {
  function useCreateModeHandlers() {
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
      http.get('/api/me/open-mics', () => HttpResponse.json({ items: [] })),
      http.get('/api/handles/check/:candidate', () => HttpResponse.json({ available: true })),
    )
  }

  it('tracks the full suggested handle as the series name is typed', async () => {
    useCreateModeHandlers()
    const user = userEvent.setup()
    renderWithProviders(<OpenMicFormPage theme="venue" mode="light" />)

    const name = await screen.findByRole('textbox', { name: /series name/i })
    await user.type(name, 'my series')

    expect(screen.getByRole('textbox', { name: /handle/i })).toHaveValue('my-series')
    expect(screen.getByRole('textbox', { name: /website/i })).toHaveValue('https://openmics.org/@my-series')
  }, 15000)

  it('stops syncing once the organizer edits the website field directly', async () => {
    useCreateModeHandlers()
    const user = userEvent.setup()
    renderWithProviders(<OpenMicFormPage theme="venue" mode="light" />)

    const name = await screen.findByRole('textbox', { name: /series name/i })
    await user.type(name, 'my series')
    const website = screen.getByRole('textbox', { name: /website/i })
    await user.clear(website)
    await user.type(website, 'https://example.com/custom')

    await user.type(name, '!')
    expect(website).toHaveValue('https://example.com/custom')
  }, 15000)
})
