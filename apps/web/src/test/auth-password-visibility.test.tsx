import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthPage } from '../views/AuthPage'
import { renderWithProviders } from './render'

describe('AuthPage password visibility', () => {
  it('toggles current and new password visibility independently', () => {
    renderWithProviders(<AuthPage mode="sign-up" theme="venue" colorMode="light" />)

    const passwordFields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    expect(passwordFields).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Show Password' }))
    expect(passwordFields[0]).toHaveAttribute('type', 'text')
    expect(passwordFields[1]).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: 'Show New password' }))
    expect(passwordFields[1]).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide Password' }))
    expect(passwordFields[0]).toHaveAttribute('type', 'password')
    expect(passwordFields[1]).toHaveAttribute('type', 'text')
  })
})