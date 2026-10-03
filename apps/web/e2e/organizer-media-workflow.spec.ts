import { expect, test } from '@playwright/test'

// Media gallery happy path + lifecycle (media-gallery-plan.md Phase 9): video-link upload
// through the organizer manage view, public gallery + lightbox, the /media/:id deep link,
// consent-revocation hiding, and soft-delete → recovery. Photo uploads go through a real
// presigned S3 PUT, which has no local sink in the dev/e2e environment (the local storage
// adapter is in-memory API-side); the video path exercises the same manage surfaces.
test('organizer media workflow: add video, gallery, deep link, consent hide, delete, recover', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'dev-owner')
  })

  const suffix = Date.now().toString()
  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:5173'
  const authHeaders = { Authorization: 'Bearer dev-owner', 'Content-Type': 'application/json' }

  // Fresh organizer profile per run: the default plan allows ONE series per profile, and
  // the critical-workflow spec already occupies dev-owner's primary organizer profile.
  const accountResponse = await page.request.get(`${apiBaseUrl}/api/me`, { headers: authHeaders })
  expect(accountResponse.ok()).toBeTruthy()
  const profileResponse = await page.request.post(`${apiBaseUrl}/api/profiles`, {
    headers: authHeaders,
    data: { profile_name: `Media E2E Organizer ${suffix}`, profile_kind: 'organizer' },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const organizerProfile = await profileResponse.json() as { id: string }
  const profileHeaders = { ...authHeaders, 'X-Current-Profile': organizerProfile.id }

  const seriesResponse = await page.request.post(`${apiBaseUrl}/api/open-mics`, {
    headers: profileHeaders,
    data: {
      name: `Media E2E Series ${suffix}`,
      venue_name: 'The Test Lantern',
      address_line1: '1 Test Street',
      city: 'Dublin',
      country: 'IE',
      time_zone: 'Europe/Dublin',
      activities: ['singing'],
    },
  })
  expect(seriesResponse.ok()).toBeTruthy()
  const series = await seriesResponse.json() as { id: string }

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const eventResponse = await page.request.post(`${apiBaseUrl}/api/open-mics/${series.id}/events`, {
    headers: authHeaders,
    data: {
      title: `Media E2E Night ${suffix}`,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      time_zone: 'Europe/Dublin',
      status: 'published',
      capacity: 40,
    },
  })
  expect(eventResponse.ok(), await eventResponse.text()).toBeTruthy()
  const event = await eventResponse.json() as { id: string }

  // A kiosk registration to attribute media to (organizer-supervised, consent on).
  const registrationResponse = await page.request.post(`${apiBaseUrl}/api/events/${event.id}/registrations`, {
    headers: authHeaders,
    data: { performer_name: `Media E2E Performer ${suffix}`, performer_city: 'Dublin', submission_channel: 'kiosk', organizer_supervised: true, media_consent: true },
  })
  expect(registrationResponse.ok()).toBeTruthy()
  const registration = await registrationResponse.json() as { id: string }

  // --- Add a video link through the organizer manage view ---------------------------
  await page.goto(`/dashboard/series/${series.id}/events/${event.id}/media`)
  await page.getByRole('button', { name: '+ Add video' }).click()
  await page.locator('input[type="url"]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  // Attribute to the kiosk registration.
  const attributionSelect = page.locator('.media-video-form select')
  await attributionSelect.selectOption(registration.id)
  await page.getByRole('button', { name: 'Add video', exact: true }).click()

  // The manage grid shows the new item (alt text from the default caption + attribution).
  const manageTile = page.getByRole('button', { name: /Media E2E Performer/ }).first()
  await expect(manageTile).toBeVisible()

  const mediaListResponse = await page.request.get(`${apiBaseUrl}/api/events/${event.id}/media`)
  const mediaList = await mediaListResponse.json() as { items: Array<{ id: string }> }
  expect(mediaList.items).toHaveLength(1)
  const mediaId = mediaList.items[0].id

  // --- Public gallery + lightbox -----------------------------------------------------
  await page.goto(`/events/${event.id}`)
  const tile = page.getByRole('button', { name: /Media E2E Performer/ }).first()
  await expect(tile).toBeVisible()
  await tile.click()
  const lightbox = page.getByRole('dialog')
  await expect(lightbox).toBeVisible()
  // Provider iframe mounts on open with youtube-nocookie + muted autoplay (design §6.3).
  const frame = lightbox.locator('iframe')
  await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/)
  // Disabled reactions/comments reserve their slots (§6.4).
  await expect(lightbox.getByRole('button', { name: /React/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(lightbox).not.toBeVisible()

  // --- Canonical deep link -----------------------------------------------------------
  await page.goto(`/media/${mediaId}`)
  await page.waitForURL(new RegExp(`/events/${event.id}`))
  await expect(page.getByRole('dialog')).toBeVisible()

  // --- Consent revocation hides the media everywhere ---------------------------------
  const revokeResponse = await page.request.patch(`${apiBaseUrl}/api/registrations/${registration.id}`, {
    headers: authHeaders,
    data: { media_consent: false },
  })
  expect(revokeResponse.ok()).toBeTruthy()

  await page.goto(`/events/${event.id}`)
  await expect(page.getByRole('button', { name: /Media E2E Performer/ })).toHaveCount(0)
  // The stale deep link redirects to the surrounding event page with a toast (§12.1).
  await page.goto(`/media/${mediaId}`)
  await page.waitForURL(new RegExp(`/events/${event.id}`))
  await expect(page.getByRole('status').filter({ hasText: "isn't available anymore" })).toBeVisible()
  // The lightbox does NOT open for hidden media.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // --- Restore consent → media returns ----------------------------------------------
  const restoreConsent = await page.request.patch(`${apiBaseUrl}/api/registrations/${registration.id}`, {
    headers: authHeaders,
    data: { media_consent: true },
  })
  expect(restoreConsent.ok()).toBeTruthy()
  await page.goto(`/events/${event.id}`)
  await expect(page.getByRole('button', { name: /Media E2E Performer/ }).first()).toBeVisible()

  // --- Soft-delete from the manage view, then recover --------------------------------
  await page.goto(`/dashboard/series/${series.id}/events/${event.id}/media`)
  const tileToDelete = page.locator('.media-manage-tile').first()
  await tileToDelete.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

  await page.getByRole('tab', { name: 'Recently deleted' }).click()
  await expect(page.getByText('Media E2E Night', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).first().click()

  await page.goto(`/events/${event.id}`)
  await expect(page.getByRole('button', { name: /Media E2E Performer/ }).first()).toBeVisible()
})
