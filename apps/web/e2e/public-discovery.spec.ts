import { expect, test } from '@playwright/test'

const cork = {
  id: 'city-cork', city: 'Cork', city_ascii: 'Cork', country: 'Ireland', country_ascii: 'Ireland',
  iso2: 'IE', iso3: 'IRL', admin_name: null, lat: 51.8985, lng: -8.4756, population: 222333,
}

const series = (index: number) => ({
  id: `series-${index}`, public_code: `STAGE${index}`, owner_profile_id: 'owner', current_handle: null,
  name: `Stage ${index}`, description: 'A welcoming room', venue_name: 'Test venue', city: 'Cork', country: 'IE',
  city_id: cork.id, activities: ['singing'], tags: [], registration_mode: 'both', external_registration_url: null, status: 'active',
})

const event = (index: number) => ({
  id: `event-${index}`, public_code: `NIGHT${index}`, open_mic_id: `series-${index}`, title: `Night ${index}`,
  starts_at: '2099-01-01T19:00:00Z', ends_at: '2099-01-01T22:00:00Z', time_zone: 'Europe/Dublin',
  venue_name: 'Test venue', city: 'Cork', country: 'IE', status: 'published', phase: 'future',
  registrations_closed_at: null, activities: ['singing'], tags: [], capacity: 50, notes: null,
})

for (const mobile of [false, true]) {
  test(`city discovery, expansion, pagination and session reset (${mobile ? 'mobile' : 'desktop'})`, async ({ page, context }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 53.35, longitude: -6.26 })
    const resultQueries: URL[] = []
    let externalLookups = 0
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname
      let body: unknown
      if (path === '/api/dev/simulated-auth/config') body = { enabled: false, roles: [] }
      else if (path === '/api/cities/search') body = { items: [cork] }
      else if (path === '/api/cities/search-external') { externalLookups++; body = { items: [] } }
      else if (path === '/api/discovery/suggestions') body = {
        expansion: url.searchParams.get('radius_km') === '50' ? { radius_km: 135, additional_count: 22 } : null,
        cities: [{ ...cork, distance_km: 218, open_mic_count: 4 }],
      }
      else if (path === '/api/open-mics') {
        resultQueries.push(url)
        const count = Number(url.searchParams.get('page_size') ?? 3)
        const number = Number(url.searchParams.get('page') ?? 1)
        body = { items: Array.from({ length: number === 2 ? 5 : count }, (_, i) => series((number - 1) * count + i + 1)),
          pagination: { page: number, page_size: count, total: 25 } }
      }
      else if (path === '/api/events/upcoming') {
        resultQueries.push(url)
        body = [event(1), event(2), event(3)]
      }
      else if (path === '/api/events/discovery') {
        resultQueries.push(url)
        const number = Number(url.searchParams.get('page') ?? 1)
        body = { items: Array.from({ length: number === 2 ? 5 : 20 }, (_, i) => event((number - 1) * 20 + i + 1)),
          pagination: { page: number, page_size: 20, total: 25 } }
      }
      else if (path.endsWith('/featured-media')) body = { items: [] }
      else if (path.endsWith('/media')) body = { items: [], prev_cursor: null, next_cursor: null }
      else if (path.startsWith('/api/events/')) body = event(Number(path.match(/\d+$/)?.[0] ?? 1))
      else if (path.startsWith('/api/open-mics/')) body = series(Number(path.match(/\d+$/)?.[0] ?? 1))
      else {
        await route.fulfill({ status: path === '/api/me' ? 401 : 404, json: { error: { code: 'UNAUTHORIZED', message: 'Not signed in' } } })
        return
      }
      await route.fulfill({ json: body })
    })

    await page.goto('/')
    await expect(page.getByText('Near your location · Within 50 km')).toBeVisible()
    await page.getByRole('button', { name: 'Choose a city', exact: true }).click()
    await page.getByRole('combobox', { name: 'Choose a city', exact: true }).fill('Cork')
    await page.getByRole('option', { name: /Cork.*Ireland/ }).click()
    await expect(page.getByText('Near Cork, Ireland · Within 50 km')).toBeVisible()
    expect(externalLookups).toBe(0)

    await page.getByRole('button', { name: /Expand to 135 km.*22 more/ }).click()
    await expect(page.getByText('Near Cork, Ireland · Within 135 km')).toBeVisible()
    await expect.poll(() => resultQueries.filter(url => url.pathname.endsWith('/upcoming')).at(-1)?.searchParams.get('radius_km')).toBe('135')
    await page.getByRole('link', { name: 'View all open mics' }).click()
    await expect(page.getByRole('heading', { name: 'Stage 20', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Page 2', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Stage 21', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Upcoming events', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Night 1', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Night 1', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Night 1', exact: true })).toBeVisible()
    await page.goBack()
    await expect(page.getByText('Near Cork, Ireland · Within 135 km')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Stage 21', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Page 2', exact: true })).toHaveAttribute('aria-current', 'page')

    await page.reload()
    await expect(page.getByText('Near your location · Within 50 km')).toBeVisible()
    expect(externalLookups).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
