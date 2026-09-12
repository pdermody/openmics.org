import { describe, expect, it } from 'vitest'
import { ApiError, friendlyApiErrorMessage } from '../api/client'

describe('API error copy', () => {
  it.each([
    ['REGISTRATIONS_CLOSED', 'Registration is closed for this event.'],
    ['CAPACITY_EXCEEDED', 'This event is full. Please check back in case a place opens up.'],
    ['DUPLICATE_REGISTRATION', 'This email already has a registration for this event.'],
    ['FORBIDDEN', 'You do not have permission to view or change this.'],
  ])('maps %s to user-facing copy', (code, message) => {
    expect(friendlyApiErrorMessage(new ApiError(409, { error: { code, message: 'server detail' } }))).toBe(message)
  })

  it('uses the fallback for unknown errors', () => {
    expect(friendlyApiErrorMessage(new Error('network failure'), 'Try again later.')).toBe('Try again later.')
  })
})