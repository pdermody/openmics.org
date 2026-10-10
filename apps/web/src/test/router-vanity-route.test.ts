import { describe, expect, it } from 'vitest'
import { router } from '../App'

describe('vanity handle route matching', () => {
  it('matches canonical details and event landing routes', () => {
    for (const path of ['/@MyStage/details', '/@MyStage/events/event-1', '/@MyStage/events/event-1/details']) {
      const matches = router.matchRoutes(path, undefined, { throwOnError: true })
      expect(matches.at(-1)?.params).toMatchObject({ handle: 'MyStage' })
      if (path.includes('/events/')) expect(matches.at(-1)?.params).toMatchObject({ eventId: 'event-1' })
    }
  })
  it('matches "/@handle/register" and extracts the handle param', () => {
    const matches = router.matchRoutes('/@some-handle/register', undefined, { throwOnError: true })
    const leaf = matches[matches.length - 1]
    expect(leaf.routeId).toContain('register')
    expect(leaf.params).toMatchObject({ handle: 'some-handle' })
  })

  it('does not swallow the literal "open-mics" or "events" prefixed register routes', () => {
    const openMics = router.matchRoutes('/open-mics/abc123/register', undefined, { throwOnError: true })
    expect(openMics[openMics.length - 1].params).toMatchObject({ openMicId: 'abc123' })

    const events = router.matchRoutes('/events/abc123/register', undefined, { throwOnError: true })
    expect(events[events.length - 1].params).toMatchObject({ eventId: 'abc123' })
  })

  it('matches bare "/@handle" to the open-mic vanity route and extracts the handle param', () => {
    const matches = router.matchRoutes('/@some-handle', undefined, { throwOnError: true })
    const leaf = matches[matches.length - 1]
    expect(leaf.routeId).not.toContain('register')
    expect(leaf.params).toMatchObject({ handle: 'some-handle' })
  })
})
