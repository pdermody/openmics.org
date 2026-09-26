import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PerformerCard } from '../views/EventRosterPage'
import type { Performance, RosterRegistration } from '../features/organizer'
import { renderWithProviders } from './render'

const performance = { id: 'performance-1', status: 'registered', sequence: 1 } as Performance
const registration = {
  id: 'registration-1', performer_name: 'Ava', performer_city: 'Dublin',
  contact_email: 'ava@example.test', contact_phone: null, song_names: ['A poem'],
  media_consent: true, organizer_supervised: true, email_verified_at: null,
  performances: [performance],
} as RosterRegistration

function renderCard() {
  renderWithProviders(<main className="app"><PerformerCard eventId="event-1" data={{ registration, performance }} isWide /></main>)
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
})