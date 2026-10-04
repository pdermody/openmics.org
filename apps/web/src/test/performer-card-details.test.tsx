import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PerformerCard } from '../views/EventRosterPage'
import type { Performance, RosterRegistration } from '../features/organizer'
import { renderWithProviders } from './render'

const performance = { id: 'performance-1', status: 'registered', sequence: 1 } as Performance
const registration = {
  id: 'registration-1', performer_name: 'Ava', performer_city: 'Dublin',
  contact_email: 'ava@example.test', contact_phone: null, song_names: ['A poem'],
  media_consent: true, organizer_supervised: true, email_verified_at: null,
  visibility_state: 'valid',
  performances: [performance],
} as RosterRegistration

function renderCard(overrides: Partial<RosterRegistration> = {}, selectedPerformance = performance) {
  renderWithProviders(<main className="app"><PerformerCard eventId="event-1" data={{ registration: { ...registration, ...overrides }, performance: selectedPerformance }} isWide /></main>)
  return screen.getByRole('group', { name: /Ava.*view registration details/ })
}

describe('PerformerCard details', () => {
  it('opens on a card click, dismisses normally, and leaves the action menu independent', async () => {
    const card = renderCard()
    fireEvent.click(screen.getByText('Ava'))
    const details = await screen.findByRole('dialog', { name: 'Registration details for Ava' })
    expect(details).toHaveTextContent('A poem')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ava' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card).toBeInTheDocument()
  })

  it('opens details with Enter or Space when the card itself has focus', async () => {
    const card = renderCard()
    card.focus()
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'Registration details for Ava' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(card, { key: ' ' })
    expect(await screen.findByRole('dialog', { name: 'Registration details for Ava' })).toBeInTheDocument()
  })

  it('uses an icon-only action to replace details with the existing edit dialog', async () => {
    renderCard()
    fireEvent.click(screen.getByText('Ava'))
    const details = await screen.findByRole('dialog', { name: 'Registration details for Ava' })
    const edit = within(details).getByRole('button', { name: 'Edit' })
    expect(edit).toHaveTextContent('')
    expect(edit.querySelector('svg')).not.toBeNull()
    fireEvent.click(edit)
    expect(await screen.findByRole('dialog', { name: 'Edit registration for Ava' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Registration details for Ava' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Performer name/)).toHaveValue('Ava')
  })

  it.each(['registered', 'present', 'scheduled', 'performing', 'performed', 'no_show', 'cancelled'] as const)('opens fixed performer uploads from a %s card', async (status) => {
    renderCard({}, { ...performance, status })
    fireEvent.click(screen.getByText('Ava'))
    const details = await screen.findByRole('dialog', { name: 'Registration details for Ava' })
    const add = within(details).getByRole('button', { name: 'Add media' })
    expect(add).toHaveTextContent('')
    fireEvent.click(add)
    const upload = await screen.findByRole('dialog', { name: 'Add media for Ava' })
    expect(screen.queryByRole('dialog', { name: 'Registration details for Ava' })).not.toBeInTheDocument()
    expect(upload).toHaveTextContent('Media will be attributed to Ava for this event.')
    expect(within(upload).queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(within(upload).getByRole('button', { name: '+ Add video' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(upload).getByLabelText('Video URL')).toBeInTheDocument()
    fireEvent.click(within(upload).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    { media_consent: false, visibility_state: 'valid' as const, explanation: 'Enable media consent' },
    { media_consent: true, visibility_state: 'pending' as const, explanation: 'Media can only be added' },
  ])('explains why media cannot be added: $explanation', async ({ explanation, ...overrides }) => {
    renderCard(overrides)
    fireEvent.click(screen.getByText('Ava'))
    const details = await screen.findByRole('dialog', { name: 'Registration details for Ava' })
    const add = within(details).getByRole('button', { name: 'Add media' })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription(new RegExp(explanation))
    expect(within(details).getByRole('button', { name: 'Edit' })).toBeEnabled()
  })
})