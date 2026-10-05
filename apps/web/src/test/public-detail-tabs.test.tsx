import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicDetailTabs } from '../components/PublicDetailTabs'
import { parseDetailBrowse } from '../features/detailBrowsing'
import type { MediaScope } from '../features/media'
import { mediaItem } from './media-fixtures'
import { createTestQueryClient } from './render'
import { server } from './server'

const photo = mediaItem({ id: 'photo-1', open_mic_id: 'series-1', event_id: null, alt_text: 'Featured photo' })
const video = mediaItem({ id: 'video-1', open_mic_id: 'series-1', event_id: null, media_type: 'video', video_platform: 'youtube', platform_video_id: 'testvideo', alt_text: 'Featured video' })
const gridPhoto = mediaItem({ id: 'photo-2', alt_text: 'Archive photo' })
const gridVideo = mediaItem({ id: 'video-2', media_type: 'video', video_platform: 'youtube', platform_video_id: 'archive', alt_text: 'Archive video' })

function mount(scope: MediaScope, query = '') {
  const root = createRootRoute()
  const path = scope.kind === 'open-mic' ? '/open-mics/$openMicId' : scope.kind === 'event' ? '/events/$eventId' : '/profiles/$profileId'
  const route = createRoute({ getParentRoute: () => root, path, validateSearch: (search) => search, component: () => <PublicDetailTabs scope={scope} /> })
  const url = scope.kind === 'open-mic' ? '/open-mics/series-1' : scope.kind === 'event' ? '/events/event-1' : '/profiles/profile-1'
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [url + query] }) })
  render(<QueryClientProvider client={createTestQueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  server.use(
    http.get('/api/open-mics/series-1/featured-media', ({ request }) => {
      expect(new URL(request.url).searchParams.get('public_view')).toBe('true')
      return HttpResponse.json({ items: [photo, video] })
    }),
    http.get('/api/open-mics/series-1/public-events', ({ request }) => {
      const params = new URL(request.url).searchParams
      const page = Number(params.get('page'))
      const period = params.get('period')
      const items = Array.from({ length: page === 3 ? 3 : 10 }, (_, index) => ({
        id: `event-${(page - 1) * 10 + index}`, title: `${period} night ${(page - 1) * 10 + index}`,
        starts_at: '2026-12-31T23:30:00Z', time_zone: 'Europe/Paris', venue_name: 'Venue', city: 'Paris',
        phase: index === 0 && page === 1 && period === 'upcoming' ? 'running' : period === 'past' ? 'past' : 'future',
      }))
      return HttpResponse.json({ items, pagination: { page, page_size: 10, total: 23 }, available_years: [2027, 2026] })
    }),
    http.get('/api/open-mics/series-1/media', ({ request }) => {
      const params = new URL(request.url).searchParams
      expect(params.get('public_view')).toBe('true')
      expect(params.get('exclude_featured')).toBe('true')
      return HttpResponse.json({ items: [params.get('type') === 'photo' ? gridPhoto : gridVideo], prev_cursor: null, next_cursor: null })
    }),
    http.get('/api/events/event-1/media', () => HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })),
    http.get('/api/profiles/profile-1/media', () => HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })),
    http.get('/api/media/video-2', () => HttpResponse.json(gridVideo)),
  )
})

describe('public browsing tabs', () => {
  it('defaults to Events, paginates by ten, uses venue dates and resets page on filters', async () => {
    const user = userEvent.setup()
    const router = mount({ kind: 'open-mic', id: 'series-1' })
    expect(await screen.findByRole('tab', { name: 'Events', selected: true })).toBeInTheDocument()
    await screen.findByRole('link', { name: 'upcoming night 0' })
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(screen.getByText('Happening now')).toBeInTheDocument()
    expect(screen.getAllByText(/Jan 1, 2027/)).toHaveLength(10)
    expect(screen.getByLabelText('Month')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 3')
    await user.selectOptions(screen.getByLabelText('Year'), '2027')
    await screen.findByText('Page 1 of 3')
    await user.selectOptions(screen.getByLabelText('Month'), '1')
    expect(router.state.location.search).toMatchObject({ year: 2027, month: 1, page: 1 })
    await user.click(screen.getByRole('button', { name: 'Past' }))
    await screen.findByRole('link', { name: 'past night 0' })
    expect(router.state.location.search).toMatchObject({ period: 'past', year: 2027, month: 1, page: 1 })
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search.year).toBeUndefined())
  })

  it('keeps featured viewers in their selection without changing Events, then opens explicit media tabs', async () => {
    const user = userEvent.setup()
    mount({ kind: 'open-mic', id: 'series-1' })
    const tile = await screen.findByRole('button', { name: 'Featured photo' })
    expect(screen.getByRole('heading', { name: 'Featured photos and videos' })).toBeInTheDocument()
    await user.click(tile)
    await screen.findByRole('dialog', { name: 'Featured photo' })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next media' }))
    await screen.findByRole('dialog', { name: 'Featured video' })
    expect(screen.queryByRole('button', { name: 'Next media' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(tile).toHaveFocus())
    expect(screen.getByRole('tab', { name: 'Events', selected: true })).toBeInTheDocument()
    await user.click(tile)
    await user.click(await screen.findByRole('button', { name: 'Browse all videos' }))
    expect(await screen.findByRole('tab', { name: 'Videos', selected: true })).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Archive video' })
    expect(screen.queryByRole('button', { name: 'Featured photo' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Featured video' })).toHaveLength(1)
  })

  it('restores page/filter/tab state with Back and Forward and supports keyboard tabs', async () => {
    const user = userEvent.setup()
    const router = mount({ kind: 'open-mic', id: 'series-1' }, '?page=2&period=past')
    await screen.findByText('Page 2 of 3')
    await user.click(screen.getByRole('tab', { name: 'Photos' }))
    await screen.findByRole('button', { name: 'Archive photo' })
    router.history.back()
    expect(await screen.findByRole('tab', { name: 'Events', selected: true })).toBeInTheDocument()
    await screen.findByText('Page 2 of 3')
    router.history.forward()
    expect(await screen.findByRole('tab', { name: 'Photos', selected: true })).toBeInTheDocument()
    screen.getByRole('tab', { name: 'Photos' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('tab', { name: 'Videos', selected: true })).toHaveFocus()
  })

  it('does not scroll the page when selecting or revisiting tabs', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    mount({ kind: 'open-mic', id: 'series-1' })
    await screen.findByRole('link', { name: 'upcoming night 0' })
    vi.mocked(window.scrollTo).mockClear()
    scrollIntoView.mockClear()
    for (const name of ['Photos', 'Videos', 'Events', 'Photos']) {
      await user.click(screen.getByRole('tab', { name }))
      await screen.findByRole('tab', { name, selected: true })
    }
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('tab', { name: 'Videos', selected: true })
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it.each(['event', 'profile'] as const)('keeps both empty media tabs on %s pages without All or featured', async (kind) => {
    const user = userEvent.setup()
    mount({ kind, id: kind === 'event' ? 'event-1' : 'profile-1' })
    expect(await screen.findByRole('tab', { name: 'Photos', selected: true })).toBeInTheDocument()
    await screen.findByText('No photos yet.')
    expect(screen.queryByRole('heading', { name: 'Featured photos and videos' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'All' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Videos' }))
    await screen.findByText('No videos yet.')
  })

  it('opens a video deep link in Videos and closes without reopening it', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/events/event-1/media', ({ request }) => {
      expect(new URL(request.url).searchParams.get('type')).toBe('video')
      return HttpResponse.json({ items: [gridVideo], prev_cursor: null, next_cursor: null })
    }))
    const router = mount({ kind: 'event', id: 'event-1' }, '?media=video-2')
    const dialog = await screen.findByRole('dialog', { name: 'Archive video' })
    expect(within(dialog).getByTitle('Archive video')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(router.state.location.search.media).toBeUndefined())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Videos', selected: true })).toBeInTheDocument()
  })

  it('keeps shuffle preference and seed when switching media tabs', async () => {
    const user = userEvent.setup()
    const seeds: (string | null)[] = []
    server.use(http.get('/api/open-mics/series-1/media', ({ request }) => {
      const params = new URL(request.url).searchParams
      if (params.get('sort') === 'shuffle') seeds.push(params.get('seed'))
      return HttpResponse.json({ items: [], prev_cursor: null, next_cursor: null })
    }))
    mount({ kind: 'open-mic', id: 'series-1' })
    await user.click(await screen.findByRole('tab', { name: 'Photos' }))
    await user.selectOptions(await screen.findByLabelText('Sort'), 'shuffle')
    await waitFor(() => expect(seeds.length).toBeGreaterThan(0))
    await user.click(screen.getByRole('tab', { name: 'Videos' }))
    await waitFor(() => expect(seeds.length).toBeGreaterThan(1))
    expect(seeds.every((seed) => seed !== null && /^\d+$/.test(seed))).toBe(true)
    expect(new Set(seeds).size).toBe(1)
    expect(localStorage.getItem('openmic-media-sort')).toBe('shuffle')
  })

  it.each(['series-1', 'different-series'])('checks event-media anchors against their parent series (%s)', async (parentId) => {
    server.use(http.get('/api/events/event-1', () => HttpResponse.json({ open_mic_id: parentId })))
    mount({ kind: 'open-mic', id: 'series-1' }, '?media=video-2')
    if (parentId === 'series-1') {
      const user = userEvent.setup()
      const dialog = await screen.findByRole('dialog', { name: 'Archive video' })
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      expect(screen.getByRole('tab', { name: 'Videos', selected: true })).toBeInTheDocument()
    } else {
      await screen.findByText(/That photo or video isn.t available anymore/)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByRole('tab', { name: 'Events', selected: true })).toBeInTheDocument()
    }
  })
})

it('normalizes legacy links and invalid numeric browse state', () => {
  expect(parseDetailBrowse('?type=video&page=0&month=12', true)).toMatchObject({ tab: 'videos', page: 1, month: undefined })
  expect(parseDetailBrowse('?type=all', true).tab).toBe('events')
  expect(parseDetailBrowse('?tab=events', false).tab).toBe('photos')
})
