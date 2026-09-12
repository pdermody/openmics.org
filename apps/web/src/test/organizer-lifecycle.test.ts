import { describe, expect, it } from 'vitest'
import { nextPerformanceAction, PERFORMANCE_STATUS_LABELS } from '../features/organizer'

describe('organizer performance lifecycle', () => {
  it.each([
    ['registered', 'Check in', 'present'],
    ['present', 'Schedule', 'scheduled'],
    ['scheduled', 'Start', 'performing'],
    ['performing', 'Finish', 'performed'],
  ] as const)('maps %s to its next action', (status, label, nextStatus) => {
    expect(nextPerformanceAction(status)).toEqual({ label, nextStatus })
  })

  it.each(['performed', 'no_show', 'cancelled'] as const)('does not offer a forward action after %s', (status) => {
    expect(nextPerformanceAction(status)).toBeNull()
  })

  it('keeps human-readable labels for every roster status', () => {
    expect(PERFORMANCE_STATUS_LABELS).toMatchObject({
      registered: 'Registered',
      present: 'Present',
      scheduled: 'Scheduled',
      performing: 'Performing',
      performed: 'Performed',
      no_show: 'No-show',
      cancelled: 'Cancelled',
    })
  })
})