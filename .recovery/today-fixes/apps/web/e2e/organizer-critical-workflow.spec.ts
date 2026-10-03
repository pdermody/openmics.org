import { expect, test, type Page } from '@playwright/test'

test('organizer critical workflow: create, operate, and protect an event night', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'dev-owner')
  })

  const suffix = Date.now().toString()
  const seriesName = `Playwright Series ${suffix}`
  const eventTitle = `Playwright Event ${suffix}`
  const performerName = `Playwright Performer ${suffix}`

  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:5173'
  const authHeaders = { Authorization: 'Bearer dev-owner' }
  const accountResponse = await page.request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders })
  expect(accountResponse.ok()).toBeTruthy()
  const account = await accountResponse.json() as { id: string }
  const profilesResponse = await page.request.get(`${apiBaseUrl}/api/accounts/${account.id}/profiles`, { headers: authHeaders })
  expect(profilesResponse.ok()).toBeTruthy()
  const profiles = await profilesResponse.json() as { items: Array<{ id: string; profile_kind: string }> }
  const organizer = profiles.items.find((profile) => profile.profile_kind === 'organizer')
  expect(organizer).toBeTruthy()
  const profileSwitch = await page.request.put(`${apiBaseUrl}/api/accounts/${account.id}/current-profile`, {
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    data: { profile_id: organizer!.id },
  })
  expect(profileSwitch.ok()).toBeTruthy()

  await page.goto('/dashboard/series/new')
  await expect(page.getByRole('heading', { name: 'Create an open mic series' })).toBeVisible()
  await page.locator('input[name="name"]').fill(seriesName)
  await page.getByRole('tab', { name: 'Location' }).click()
  await page.locator('input[name="venue_name"]').fill('The Test Lantern')
  await page.locator('input[name="address_line1"]').fill('1 Test Street')
  await page.locator('input[name="city"]').fill('Dublin')
  await page.locator('select[name="country"]').selectOption('IE')
  await page.getByRole('tab', { name: 'Basics' }).click()
  await page.getByRole('checkbox', { name: 'singing' }).check()
  await page.getByRole('button', { name: 'Create series' }).click()

  await page.waitForURL(/\/dashboard\/series\/(?!new$)[^/]+$/)
  const seriesId = page.url().match(/\/dashboard\/series\/([^/]+)$/)?.[1]
  expect(seriesId).toBeTruthy()

  await expect(page.getByRole('button', { name: 'Set backup PIN' })).toBeVisible()
  await page.getByRole('button', { name: 'Set backup PIN' }).click()
  const pinInputs = page.locator('.kiosk-form input[type="password"]')
  await pinInputs.nth(0).fill('2468')
  await pinInputs.nth(1).fill('2468')
  await page.getByRole('button', { name: 'Save backup PIN' }).click()
  await expect(page.getByText('Backup PIN set')).toBeVisible()

  const seriesDetailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/api/open-mics/${seriesId}` && response.request().method() === 'GET'
  })
  await page.goto(`/dashboard/series/${seriesId}/events/new`)
  const seriesDetail = await seriesDetailResponse
  expect(seriesDetail.status(), await seriesDetail.text()).toBe(200)
  await expect(page.getByRole('heading', { name: /New event for/ })).toBeVisible()
  await page.locator('input[name="title"]').fill(eventTitle)
  await page.locator('input[name="starts_at"]').fill('2026-10-01T19:00')
  // The default plan rejects unlimited capacity — the event form requires one (max 50).
  await page.locator('input[name="capacity"]').fill('40')
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.waitForURL((url) => /^\/events\/[^/]+$/.test(url.pathname))

  await page.goto(`/dashboard/series/${seriesId}`)
  const rosterLink = page.locator('a[href*="/roster"]').first()
  await expect(rosterLink).toBeVisible()
  const rosterHref = await rosterLink.getAttribute('href')
  expect(rosterHref).toBeTruthy()
  const eventId = rosterHref!.match(/\/events\/([^/]+)\/roster$/)?.[1]
  expect(eventId).toBeTruthy()

  await page.goto(`/dashboard/series/${seriesId}/events/${eventId}/kiosk`)
  await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible()
  await page.locator('.kiosk-form input').first().fill(performerName)
  await page.getByRole('button', { name: 'Add to roster' }).click()
  await expect(page.getByRole('status')).toContainText(`${performerName} added to the roster`)

  await page.getByRole('button', { name: 'Exit kiosk' }).click()
  await expect(page.getByRole('heading', { name: 'Enter PIN to exit kiosk' })).toBeVisible()
  await enterPin(page, '1357')
  await expect(page.getByRole('alert')).toHaveText('Incorrect PIN.')
  await enterPin(page, '2468')
  await page.waitForURL(new RegExp(`/dashboard/series/${seriesId}/events/${eventId}/roster$`))

  const performerCard = page.locator('.performer-card').filter({ hasText: performerName })
  await expect(performerCard).toBeVisible()
  await expect(page.getByRole('heading', { name: /Present/ })).toBeVisible()
  await performerCard.getByRole('button', { name: 'Move forward a stage' }).click()
  await expect(page.getByRole('heading', { name: /Scheduled/ })).toBeVisible()
  await performerCard.getByRole('button', { name: 'Move forward a stage' }).click()
  await expect(page.getByRole('heading', { name: /Performing/ })).toBeVisible()
  await performerCard.getByRole('button', { name: 'Move forward a stage' }).click()
  await expect(page.getByRole('heading', { name: /Performed/ })).toBeVisible()

  await page.getByRole('button', { name: 'Event actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download QR' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('registration-qr.png')
})

async function enterPin(page: Page, pin: string) {
  const inputs = page.locator('input[aria-label^="PIN digit"]')
  for (const [index, digit] of [...pin].entries()) {
    await inputs.nth(index).fill(digit)
  }
}