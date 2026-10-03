import { resolveAltText, resolveCaption, type MediaDisplayContext } from './captions.js';
import type { MediaListRow } from './repository.js';

function formatEventDate(startsAt: Date | null, timeZone: string | null): string | null {
  if (!startsAt) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timeZone ?? 'UTC' }).format(startsAt);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(startsAt);
  }
}

export function mediaDisplayContext(row: MediaListRow): MediaDisplayContext {
  return {
    performerName: row.attribution_name,
    performerCity: row.attribution_city,
    eventName: row.event_name,
    eventDate: formatEventDate(row.event_starts_at, row.event_time_zone),
    seriesName: row.series_name,
  };
}

/**
 * Media serialization (openapi.yaml → Media).
 *
 * - `alt_text` is derived on read from the substituted caption (design §6.6) so caption
 *   and re-attribution edits never leave it stale; the stored column stays NULL in
 *   Phase 1. Server-side derivation uses the English default-caption shapes — alt text
 *   doubles as OG output, where English-only defaults are the settled Phase 1 behavior.
 * - Tile/lightbox captions render client-side: `caption` carries the raw organizer
 *   template and `caption_context` + `attribution` carry the substitution values, so the
 *   web can localize default captions and date formats (i18next) instead of baking the
 *   server's English defaults into the UI.
 */
export function serializeMedia(row: MediaListRow) {
  const context = mediaDisplayContext(row);
  const attributed = row.registration_id !== null && row.attribution_name !== null;
  return {
    id: row.id,
    media_type: row.media_type,
    event_id: row.event_id,
    open_mic_id: row.open_mic_id,
    registration_id: row.registration_id,
    added_by_profile_id: row.added_by_profile_id,
    deleted_at: row.deleted_at,
    recovery_deadline: row.recovery_deadline,
    deletion_reason: row.deletion_reason,
    source_url: row.source_url,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    caption: row.caption,
    thumbnail_url: row.thumbnail_url,
    width: row.width,
    height: row.height,
    duration_seconds: row.duration_seconds,
    video_platform: row.video_platform,
    platform_video_id: row.platform_video_id,
    alt_text: row.alt_text ?? resolveAltText({ mediaType: row.media_type, caption: row.caption }, context),
    renditions: row.renditions,
    attribution: attributed
      ? {
          performer_name: row.attribution_name,
          performer_city: row.attribution_city,
          profile_id: row.attribution_profile_id,
          profile_handle: row.attribution_handle,
        }
      : null,
    caption_context: {
      event_name: row.event_name,
      event_starts_at: row.event_starts_at,
      event_time_zone: row.event_time_zone,
      series_name: row.series_name,
    },
    created_at: row.created_at,
  };
}
