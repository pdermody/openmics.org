import type { MediaItem } from '../features/media'

let counter = 0

/** Media fixture factory for web tests (shape mirrors openapi.yaml → Media). */
export function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  counter += 1
  const id = overrides.id ?? `00000000-0000-4000-8000-0000000000${String(counter).padStart(2, '0')}`
  return {
    id,
    media_type: 'photo',
    event_id: 'event-1',
    open_mic_id: null,
    registration_id: null,
    added_by_profile_id: 'owner-1',
    deleted_at: null,
    recovery_deadline: null,
    deletion_reason: null,
    source_url: `https://media.test/original/${id}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 2048,
    caption: null,
    thumbnail_url: null,
    width: 1200,
    height: 800,
    duration_seconds: null,
    video_platform: null,
    platform_video_id: null,
    alt_text: `Photo ${counter}`,
    renditions: {
      thumb: { url: `https://media.test/renditions/${id}/thumb.webp`, width: 400, height: 267, mime_type: 'image/webp', size_bytes: 12000 },
      grid: { url: `https://media.test/renditions/${id}/grid.webp`, width: 800, height: 533, mime_type: 'image/webp', size_bytes: 45000 },
      lightbox: { url: `https://media.test/renditions/${id}/lightbox.webp`, width: 1200, height: 800, mime_type: 'image/webp', size_bytes: 140000 },
      original: { url: `https://media.test/original/${id}.jpg`, width: 1200, height: 800, mime_type: 'image/jpeg', size_bytes: 2048 },
    },
    attribution: null,
    caption_context: { event_name: 'Friday Stage', event_starts_at: '2026-12-15T19:00:00.000Z', event_time_zone: 'Europe/Dublin', series_name: 'Nighttown' },
    created_at: `2026-12-15T19:0${counter}:00.000Z`,
    ...overrides,
  }
}
