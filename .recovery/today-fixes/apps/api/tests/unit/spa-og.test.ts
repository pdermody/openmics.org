import { describe, expect, it } from 'vitest';

import { fallbackOgTags, injectOgTags, mediaOgTags } from '../../src/spa-routes.js';
import type { MediaListRow } from '../../src/media/repository.js';

const HTML = '<!doctype html><html><head><title>OpenMics.org</title></head><body><div id="root"></div></body></html>';

function mediaFixture(overrides: Partial<MediaListRow> = {}): MediaListRow {
  return {
    id: 'm1',
    media_type: 'photo',
    event_id: 'event-1',
    open_mic_id: null,
    registration_id: 'reg-1',
    added_by_profile_id: 'owner-1',
    source_url: 'https://media.test/original/m1.jpg',
    mime_type: 'image/jpeg',
    size_bytes: '1024',
    width: 1200,
    height: 800,
    duration_seconds: null,
    video_platform: null,
    platform_video_id: null,
    thumbnail_url: null,
    caption: '{performer_name} live at {event_name}',
    alt_text: null,
    renditions: null,
    performer_name_snapshot: 'Amy Hart',
    performer_city_snapshot: 'Dublin',
    created_at: new Date('2026-12-15T19:00:00Z'),
    updated_at: new Date('2026-12-15T19:00:00Z'),
    deleted_at: null,
    deleted_by_profile_id: null,
    recovery_deadline: null,
    deletion_reason: null,
    event_name: 'Friday Stage',
    event_starts_at: new Date('2026-12-15T19:00:00Z'),
    event_time_zone: 'Europe/Dublin',
    series_name: 'Nighttown',
    attribution_name: 'Amy Hart',
    attribution_city: 'Dublin',
    attribution_profile_id: null,
    attribution_handle: null,
    event_status: 'published',
    event_deleted_at: null,
    series_id: 'series-1',
    series_status: 'active',
    series_deleted_at: null,
    series_owner_profile_id: 'owner-1',
    series_handle: 'nighttown',
    ...overrides,
  } as MediaListRow;
}

describe('injectOgTags', () => {
  it('stamps OG + twitter tags into <head>', () => {
    const out = injectOgTags(HTML, { title: 'Amy live', description: 'Friday Stage · 15 Dec 2026', image: 'https://media.test/x.webp', url: 'https://openmics.org/media/m1' });
    expect(out).toContain('<meta property="og:title" content="Amy live">');
    expect(out).toContain('<meta property="og:site_name" content="OpenMics.org">');
    expect(out).toContain('<meta property="og:url" content="https://openmics.org/media/m1">');
    expect(out).toContain('<meta property="og:description" content="Friday Stage · 15 Dec 2026">');
    expect(out).toContain('<meta property="og:image" content="https://media.test/x.webp">');
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(out).toContain('<meta name="twitter:image" content="https://media.test/x.webp">');
    expect(out.indexOf('</head>')).toBeGreaterThan(out.indexOf('og:title'));
  });

  it('escapes attribute values', () => {
    const out = injectOgTags(HTML, { title: 'Amy "The Voice" & Friends <live>', url: 'https://openmics.org/media/m1' });
    expect(out).toContain('Amy &quot;The Voice&quot; &amp; Friends &lt;live&gt;');
  });

  it('omits og:image when none is provided (event/series fallback has no cover column)', () => {
    const out = injectOgTags(HTML, { title: 'Friday Stage', url: 'https://openmics.org/events/e1' });
    expect(out).not.toContain('og:image');
    expect(out).not.toContain('twitter:image');
  });

  it('never emits og:video', () => {
    const out = injectOgTags(HTML, { title: 'Clip', url: 'https://openmics.org/media/m1', image: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    expect(out).not.toContain('og:video');
  });
});

describe('mediaOgTags', () => {
  it('uses the substituted caption as og:title and lightbox rendition as og:image', () => {
    const tags = mediaOgTags(mediaFixture(), 'https://openmics.org');
    expect(tags.title).toBe('Amy Hart live at Friday Stage');
    expect(tags.description).toBe('Friday Stage · 15 Dec 2026');
    expect(tags.image).toBe('https://media.test/original/m1.jpg');
    expect(tags.url).toBe('https://openmics.org/media/m1');
  });

  it('prefers the lightbox rendition when available', () => {
    const tags = mediaOgTags(
      mediaFixture({ renditions: { lightbox: { url: 'https://media.test/renditions/m1/lightbox.webp', width: 2048, height: 1365, mime_type: 'image/webp', size_bytes: 10 } } }),
      'https://openmics.org',
    );
    expect(tags.image).toBe('https://media.test/renditions/m1/lightbox.webp');
  });

  it('uses the provider thumbnail for videos', () => {
    const tags = mediaOgTags(
      mediaFixture({ media_type: 'video', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', video_platform: 'youtube', platform_video_id: 'dQw4w9WgXcQ' }),
      'https://openmics.org',
    );
    expect(tags.image).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('falls back to a readable title when no caption resolves', () => {
    const tags = mediaOgTags(mediaFixture({ caption: null, attribution_name: null }), 'https://openmics.org');
    expect(tags.title).toBe('Photo from Friday Stage');
  });
});

describe('fallbackOgTags (stale/hidden deep-links)', () => {
  it('falls back to the owning event with the vanity URL and no image', () => {
    const tags = fallbackOgTags(mediaFixture(), 'https://openmics.org');
    expect(tags).toEqual({ title: 'Friday Stage', url: 'https://openmics.org/@nighttown/events/event-1' });
  });

  it('falls back to the series for free-standing media', () => {
    const tags = fallbackOgTags(mediaFixture({ event_id: null, event_name: null, open_mic_id: 'series-1' }), 'https://openmics.org');
    expect(tags).toEqual({ title: 'Nighttown', url: 'https://openmics.org/@nighttown' });
  });

  it('falls back to the site root when nothing is known', () => {
    const tags = fallbackOgTags(mediaFixture({ event_id: null, event_name: null, open_mic_id: null, series_id: null, series_name: null, series_handle: null }), 'https://openmics.org');
    expect(tags).toEqual({ title: 'OpenMics.org', url: 'https://openmics.org' });
  });
});
