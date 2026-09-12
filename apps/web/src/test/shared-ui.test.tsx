import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'
import { ReadState } from '../views/shared'

describe('shared UI states', () => {
  it('renders loading text as a status and has no basic accessibility violations', async () => {
    const { container } = render(<ReadState message="Loading events…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading events…')
    expect((await axe(container)).violations).toEqual([])
  })
})