import { userEvent } from '@testing-library/user-event'
import { waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PinCombinationInput } from '../views/KioskPage'
import { renderWithProviders } from './render'

describe('PinCombinationInput', () => {
  it('masks digits, clears with backspace, and accepts another entry after completion', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithProviders(<PinCombinationInput onComplete={onComplete} />)

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    expect(inputs).toHaveLength(4)
    expect(inputs[0]).toHaveAttribute('type', 'password')

    await user.type(inputs[0], '12')
    await user.keyboard('{Backspace}')
    expect(inputs[1]).toHaveValue('')
    await user.keyboard('{Backspace}')
    expect(inputs[1]).toHaveValue('')
    expect(inputs[0]).toHaveFocus()

    await user.type(inputs[0], '2345')
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('2345'))
    expect(inputs.every((input) => input instanceof HTMLInputElement && input.value === '')).toBe(true)

    await user.type(inputs[0], '6789')
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('6789'))
  })

  it('refocuses the first digit after a verification attempt finishes', async () => {
    const user = userEvent.setup()
    function VerificationHarness() {
      const [disabled, setDisabled] = useState(false)
      return <PinCombinationInput onComplete={() => {
        setDisabled(true)
        window.setTimeout(() => setDisabled(false), 0)
      }} disabled={disabled} />
    }

    const { container } = renderWithProviders(<VerificationHarness />)
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    await user.type(inputs[0], '1234')
    await waitFor(() => expect(inputs[0]).toHaveFocus())
    await user.type(inputs[0], '5')
    expect(inputs[0]).toHaveValue('5')
  })
})