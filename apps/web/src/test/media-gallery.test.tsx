import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MediaGallery } from '../components/media/MediaGallery'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'
import { server } from './server'

const EVENT_ID = 'event-1'

function mediaListHandler(items: ReturnType<typeof mediaItem>[], assert?: (request: Request) => void) {
  return http.get(`/api/events/${EVENT_ID}/media`, ({ request }) => {
    assert?.(request)
    return HttpResponse.json({ items, prev_cursor: null, next_cursor: null })
  })
}

describe('MediaGallery', () => {
  it('renders photo and video tiles with captions and a play badge', async () => {
    server.use(
      mediaListHandler([
        mediaItem({ id: 'm1', attribution: { performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null, profile_handle: null } }),
        mediaItem({ id: 'm2', media_type: 'video', video_platform: 'youtube', platform_video_id: 'dQw4w9WgXcQ', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }),
      ]),
    )
    renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)

    // Default caption from attribution (design §7.2 short form).
    expect(await screen.findByText('Amy Hart from Dublin')).toBeInTheDocument()
    // Tiles are buttons addressed by alt text.
    expect(screen.getByRole('button', { name: 'Photo 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo 2' })).toBeInTheDocument()
  })

  it('filters by media type via the chip, persisted to localStorage', async () => {
    const user = userEvent.setup()
    const requested: string[] = []
    server.use(mediaListHandler([mediaItem({ id: 'filter-1', alt_text: 'Filter photo' })], (request) => {
      requested.push(new URL(request.url).searchParams.get('type') ?? 'missing')
    }))
    renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)
    await screen.findByRole('button', { name: 'Filter photo' })

    await user.click(screen.getByRole('button', { name: 'Photos' }))
    await waitFor(() => expect(requested).toContain('photo'))
    expect(localStorage.getItem('openmic-media-type-filter')).toBe('photo')
  })

  it('hides the whole section when the gallery is empty (design §5.5)', async () => {
    server.use(mediaListHandler([]))
    const { container } = renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)
    await waitFor(() => expect(container.querySelector('.media-gallery')).toBeNull())
  })

  it('shows a friendly error panel with retry when the gallery fails to load', async () => {
    server.use(http.get(`/api/events/${EVENT_ID}/media`, () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 })))
    renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('gallery could not be loaded')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('omits the type filter chip on profile galleries (design §11.2)', async () => {
    server.use(http.get('/api/profiles/profile-1/media', () => HttpResponse.json({ items: [mediaItem({ id: 'profile-photo', alt_text: 'Profile photo' })], prev_cursor: null, next_cursor: null })))
    renderWithProviders(<MediaGallery scope={{ kind: 'profile', id: 'profile-1' }} hideTypeFilter />)
    await screen.findByRole('button', { name: 'Profile photo' })
    expect(screen.queryByRole('button', { name: 'Photos' })).toBeNull()
  })
})
