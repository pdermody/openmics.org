import { describe, expect, it } from 'vitest'
import { router } from '../App'

describe('organizer route preload wiring', () => {
  it('exposes a .preload on each lazy organizer route so intent-preload can prefetch its chunk', () => {
    const paths = [
      '/dashboard',
      '/dashboard/series/new',
      '/dashboard/series/$seriesId/edit',
      '/dashboard/series/$seriesId',
      '/dashboard/series/$seriesId/events/new',
      '/dashboard/series/$seriesId/events/$eventId/edit',
      '/dashboard/series/$seriesId/events/$eventId/roster',
      '/dashboard/series/$seriesId/events/$eventId/kiosk',
      '/profiles/$profileId/edit',
    ]
    for (const path of paths) {
      const route = router.routesById[path]
      expect(route, `missing route for ${path}`).toBeTruthy()
      expect(typeof route.options.component?.preload, `${path} component should have a .preload`).toBe('function')
    }
  })
})
