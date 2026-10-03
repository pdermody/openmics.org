import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MediaGallery } from '../components/media/MediaGallery'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'
import { server } from './server'

const EVENT_ID = 'event-1'

function twoItems() {
  return [
    mediaItem({ id: 'm1', alt_text: 'Amy on stage photo', caption: '{performer_name} on stage', attribution: { performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null, profile_handle: null } }),
    mediaItem({ id: 'm2', caption: 'Crowd shot', alt_text: 'Crowd at the venue' }),
  ]
}

describe('Lightbox (via MediaGallery)', () => {
  it('opens on tile click, navigates with keyboard and buttons, closes on Escape', async () => {
    const user = userEvent.setup()
    server.use(http.get(`/api/events/${EVENT_ID}/media`, () => HttpResponse.json({ items: twoItems(), prev_cursor: null, next_cursor: null })))
    renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)

    await user.click(await screen.findByRole('button', { name: 'Amy on stage photo' }))
    // Lightbox is a dialog addressed by the media's alt text.
    expect(await screen.findByRole('dialog', { name: 'Amy on stage photo' })).toBeInTheDocument()
    // Substituted caption renders in the detail area.
    expect(screen.getByText('Amy Hart on stage', { selector: '.media-caption' })).toBeInTheDocument()
    // Attribution line below the media (§6.5).
    expect(screen.getByText('Amy Hart', { selector: '.media-attribution' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next media' }))
    expect(screen.getByText('Crowd shot', { selector: '.media-caption' })).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('Amy Hart on stage', { selector: '.media-caption' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows Share + Download for photos, and disabled reactions/comments', async () => {
    const user = userEvent.setup()
    server.use(http.get(`/api/events/${EVENT_ID}/media`, () => HttpResponse.json({ items: twoItems(), prev_cursor: null, next_cursor: null })))
    renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)

    await user.click(await screen.findByRole('button', { name: 'Amy on stage photo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Amy on stage photo' })

    // Download = direct CDN link with a download attribute (no signed URL).
    const download = screen.getByRole('link', { name: 'Download' })
    expect(download).toHaveAttribute('href', 'https://media.test/original/m1.jpg')
    expect(download).toHaveAttribute('download', 'nighttown-2026-12-15-amy-hart.jpg')

    // Reactions/Comments are visually present but disabled (existing pattern).
    const reactButton = screen.getByRole('button', { name: /React/ })
    expect(reactButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /Comment/ })).toBeDisabled()

    // Share falls back to clipboard copy when the Web Share API is unavailable (desktop).
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true })
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(clipboardWrite).toHaveBeenCalledWith(`${window.location.origin}/media/m1`)
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })

  it('mounts the provider iframe only when a video item opens', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`/api/events/${EVENT_ID}/media`, () =>
        HttpResponse.json({
          items: [mediaItem({ id: 'v1', media_type: 'video', video_platform: 'youtube', platform_video_id: 'dQw4w9WgXcQ', alt_text: 'Video clip' })],
          prev_cursor: null,
          next_cursor: null,
        }),
      ),
    )
    const { container } = renderWithProviders(<MediaGallery scope={{ kind: 'event', id: EVENT_ID }} />)
    // No iframe before opening (§6.3: iframes are not loaded until playback starts).
    expect(container.querySelector('iframe')).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'Video clip' }))
    const iframe = await screen.findByTitle('Video clip')
    expect(iframe).toHaveAttribute('src', expect.stringContaining('youtube-nocookie.com/embed/dQw4w9WgXcQ'))
    expect(iframe.getAttribute('src')).toContain('autoplay=1')
    expect(iframe.getAttribute('src')).toContain('mute=1')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull())
  })
})
