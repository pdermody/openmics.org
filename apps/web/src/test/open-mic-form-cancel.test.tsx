import { http, HttpResponse } from 'msw'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OpenMicFormPage } from '../views/OpenMicFormPage'
import { renderWithProviders } from './render'
import { server } from './server'

vi.mock('../components/location/LocationPicker', () => ({ LocationPicker: () => null }))
vi.mock('../views/KioskBackupPin', () => ({ KioskBackupPinSection: () => null }))

describe('OpenMicFormPage cancellation', () => {
  it('disables cancel when clean and confirms leaving with unsaved changes in an app modal', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    const browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
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
        id: 'series-1', owner_profile_id: 'profile-1', name: 'Friday Open Mic',
        description: null, venue_name: 'The Lantern', address_line1: '1 Main St', city: 'Dublin',
        country: 'IE', lat: 53.35, lng: -6.26, time_zone: 'Europe/Dublin',
        originals_only: false, amplification_available: false, age_policy: 'both',
        activities: ['singing'], tags: [], registration_mode: 'both', status: 'active',
      })),
    )

    renderWithProviders(<OpenMicFormPage seriesId="series-1" theme="venue" mode="light" />)
    const name = await screen.findByRole('textbox', { name: /series name/i })
    expect(name).toHaveValue('Friday Open Mic')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(cancel).toBeDisabled()
    expect(save).toBeDisabled()

    fireEvent.change(name, { target: { value: 'Saturday Open Mic' } })
    expect(cancel).toBeEnabled()
    expect(save).toBeEnabled()
    fireEvent.click(cancel)
    const dialog = await screen.findByRole('dialog', { name: 'Confirm action' })
    expect(dialog).toHaveTextContent('Discard all unsaved changes and leave this form?')
    expect(browserConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(name).toHaveValue('Saturday Open Mic')
  }, 15000)
})