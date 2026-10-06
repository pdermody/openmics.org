import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RegistrationEditModal } from '../views/EventRosterPage'
import type { RosterRegistration } from '../features/organizer'
import { renderWithProviders } from './render'
import { server } from './server'
import { dublinCity } from './city-fixtures'

const registration = {
  id: 'registration-1', performer_name: 'Ava', performer_city: null,
  contact_email: 'ava@example.test', contact_phone: null,
  song_names: ['First song'], media_consent: true,
} as RosterRegistration

function renderEdit(onClose = vi.fn()) {
  renderWithProviders(<main className="app"><RegistrationEditModal eventId="event-1" registration={registration} onClose={onClose} /></main>)
  return onClose
}

describe('RegistrationEditModal', () => {
  it('loads the linked city and clears optional text with a null reference', async () => {
    const onClose = vi.fn()
    let submitted: Record<string, unknown> | undefined
    server.use(
      http.get('/api/cities/city-dublin', () => HttpResponse.json(dublinCity)),
      http.patch('/api/registrations/registration-1', async ({ request }) => {
        submitted = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...registration, ...submitted })
      }),
    )
    renderWithProviders(<main className="app"><RegistrationEditModal eventId="event-1" registration={{ ...registration, performer_city: 'Dublin', performer_city_id: dublinCity.id }} onClose={onClose} /></main>)
    expect(await screen.findByText('Dublin, Ireland')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear city' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submitted).toMatchObject({ performer_city: null, performer_city_id: null }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('tracks changes and confirms cancellation in an app dialog', async () => {
    const onClose = renderEdit()
    const editDialog = await screen.findByRole('dialog', { name: 'Edit registration for Ava' })
    const save = within(editDialog).getByRole('button', { name: 'Save' })
    const songs = within(editDialog).getByRole('textbox', { name: 'Songs or poems (comma-separated)' })
    const name = within(editDialog).getByRole('textbox', { name: /performer name/i })
    expect(name.closest('label')?.querySelector('span')).toHaveTextContent('Performer name *')
    expect(save).toBeDisabled()

    fireEvent.change(songs, { target: { value: 'First song, New poem' } })
    expect(save).toBeEnabled()
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Confirm action' })
    expect(confirmation).toHaveTextContent('Discard all unsaved changes')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Confirm action' })).not.toBeInTheDocument()
    fireEvent.change(songs, { target: { value: 'First song' } })
    expect(save).toBeDisabled()
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Confirm action' })).not.toBeInTheDocument()
  })

  it('discards unsaved edits only after confirmation', async () => {
    const onClose = renderEdit()
    const editDialog = await screen.findByRole('dialog', { name: 'Edit registration for Ava' })
    fireEvent.change(within(editDialog).getByRole('textbox', { name: /performer name/i }), { target: { value: 'Ava Stone' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Close' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Confirm action' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits a poem alongside songs', async () => {
    const onClose = renderEdit()
    let submitted: Record<string, unknown> | undefined
    server.use(http.patch('/api/registrations/registration-1', async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ...registration, ...submitted })
    }))
    const editDialog = await screen.findByRole('dialog', { name: 'Edit registration for Ava' })
    fireEvent.change(within(editDialog).getByRole('textbox', { name: 'Songs or poems (comma-separated)' }), { target: { value: 'First song, New poem' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submitted?.song_names).toEqual(['First song', 'New poem']))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})