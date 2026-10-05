import { test, expect } from '@playwright/test'

const photo = {
  id: 'photo-1', media_type: 'photo', event_id: 'event-1', open_mic_id: null,
  registration_id: null, added_by_profile_id: 'owner', source_url: 'https://media.example.test/photo.svg',
  caption: 'A featured night', alt_text: 'Featured night photo', width: 1200, height: 800,
  renditions: null, attribution: null, thumbnail_url: null, deleted_at: null,
  caption_context: { series_name: 'Test stage', event_name: 'Night 1', event_starts_at: '2100-01-01T19:00:00Z', event_time_zone: 'UTC' },
}
const video = { ...photo, id: 'video-1', media_type: 'video', video_platform: 'youtube', platform_video_id: 'test',
  thumbnail_url: photo.source_url, alt_text: 'Featured night video' }
const series = {
  id: 'series-1', public_code: 'SERIES', owner_profile_id: 'owner', current_handle: 'TestStage', name: 'Test stage',
  description: 'A welcoming series', venue_name: 'Test venue', city: 'Dublin', country: 'IE',
  activities: ['singing'], tags: [], registration_mode: 'both', external_registration_url: null, status: 'active',
}

for (const mobile of [false, true]) {
  test(`public series browsing, featured viewers and return navigation (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('https://media.example.test/**', (route) => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#69716c"/></svg>',
    }))
    await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Test player</p>' }))
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname
      const event = (index: number) => ({
        id: `event-${index}`, public_code: `NIGHT${index}`, open_mic_id: 'series-1', title: `Night ${index}`,
        starts_at: '2100-01-01T19:00:00Z', ends_at: '2100-01-01T22:00:00Z', time_zone: 'UTC',
        venue_name: 'Test venue', city: 'Dublin', country: 'IE', status: 'published', phase: 'future',
        notes: 'Come along', registrations_closed_at: null, capacity: 50, activities: [], tags: [],
      })
      let body: unknown
      if (path === '/api/dev/simulated-auth/config') body = { enabled: false, roles: [] }
      else if (path === '/api/handles/TestStage') body = { type: 'open_mic', id: 'series-1' }
      else if (path === '/api/open-mics/series-1') body = series
      else if (path.endsWith('/next-event')) body = { current_event: null, next_event: event(1), next_registration_event: event(1) }
      else if (path.endsWith('/featured-media')) body = { items: [photo, video] }
      else if (path.endsWith('/public-events')) {
        const pageNumber = Number(url.searchParams.get('page') ?? 1)
        body = { items: Array.from({ length: pageNumber === 3 ? 3 : 10 }, (_, index) => event((pageNumber - 1) * 10 + index + 1)),
          pagination: { page: pageNumber, page_size: 10, total: 23 }, available_years: [2100] }
      } else if (path === '/api/media/video-1') body = video
      else if (path === '/api/media/photo-1') body = photo
      else if (path.endsWith('/media')) body = { items: path.startsWith('/api/events/') ? [photo] : [], prev_cursor: null, next_cursor: null }
      else if (path.startsWith('/api/events/')) body = event(Number(path.split('-').pop()))
      else {
        await route.fulfill({ status: path === '/api/me' ? 401 : 404, json: { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } } })
        return
      }
      await route.fulfill({ json: body })
    })
    await page.goto('/@TestStage')
    await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Page 1 of 3')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Featured photos and videos' })).toBeVisible()
    const rail = await page.locator('.media-featured-strip').boundingBox()
    const arrows = await page.locator('.featured-navigation button').all()
    for (const arrow of arrows) {
      const bounds = await arrow.boundingBox()
      expect(bounds!.y).toBeGreaterThan(rail!.y)
      expect(bounds!.y + bounds!.height).toBeLessThan(rail!.y + rail!.height)
    }
    if (mobile) {
      await page.locator('.featured-navigation button').last().click()
      await expect.poll(() => page.locator('.media-featured-strip').evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
      await page.locator('.featured-navigation button').first().click()
      await expect.poll(() => page.locator('.media-featured-strip').evaluate(el => el.scrollLeft)).toBe(0)
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByText('Page 2 of 3')).toBeVisible()
    const link = page.getByRole('link', { name: 'Night 11', exact: true })
    await link.scrollIntoViewIfNeeded()
    const returnScroll = await page.evaluate(() => scrollY)
    await link.click()
    await expect(page.getByRole('heading', { name: 'Night 11' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true')
    await page.goBack()
    await expect(page.getByText('Page 2 of 3')).toBeVisible()
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - returnScroll)).toBeLessThan(4)
    const tile = page.getByRole('button', { name: 'Featured night photo' })
    await tile.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('1 of 2')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(tile).toBeFocused()
    await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Photos' }).click()
    await expect(page.getByRole('button', { name: 'Featured night photo' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Featured night video' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Videos' }).click()
    await expect(page.getByRole('button', { name: 'Featured night video' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Featured night photo' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'All' })).toHaveCount(0)
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel('Sort', { exact: true }).selectOption('shuffle')
    await expect(page).toHaveURL(/sort=shuffle/)
    const seed = await page.evaluate(() => history.state.detailGallerySeed)
    await page.getByRole('tab', { name: 'Photos' }).click()
    expect(await page.evaluate(() => history.state.detailGallerySeed)).toBe(seed)
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('shuffle')
    await expect.poll(() => page.evaluate(() => history.state.detailGallerySeed)).not.toBe(seed)
  })
}
