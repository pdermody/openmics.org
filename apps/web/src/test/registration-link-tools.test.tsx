import { userEvent } from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegistrationLinkTools } from '../components/RegistrationLinkTools'
import { renderWithProviders } from './render'

describe('RegistrationLinkTools', () => {
  it('copies the registration URL and confirms the action', async () => {
    const user = userEvent.setup()

    renderWithProviders(<RegistrationLinkTools url="https://openmics.test/events/EV1/register" fileName="EV1" />)
    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument())
  })
})