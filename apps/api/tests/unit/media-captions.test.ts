import { describe, expect, it } from 'vitest';

import {
  availableCaptionTokens,
  defaultCaptionEn,
  resolveAltText,
  resolveCaption,
  substituteCaption,
} from '../../src/media/captions.js';

// MIRRORED: apps/web/src/test/media-captions.test.ts pins identical behavior for the web
// copy (apps/web/src/features/media-captions.ts). Keep both suites in lockstep.
describe('substituteCaption (token mechanics, design §7.3)', () => {
  const values = { performerName: 'Amy Hart', performerCity: 'Dublin', eventName: 'Friday Stage', eventDate: '15 Dec 2026' };

  it('substitutes all four tokens', () => {
    expect(substituteCaption('{performer_name} from {performer_city} at {event_name} on {event_date}', values)).toBe(
      'Amy Hart from Dublin at Friday Stage on 15 Dec 2026',
    );
  });

  it('drops missing tokens and trims surrounding whitespace, dashes, and punctuation', () => {
    expect(substituteCaption('{performer_name} — {performer_city}', { performerName: 'Amy Hart' })).toBe('Amy Hart');
    expect(substituteCaption('{performer_name} · {event_name}', { performerName: 'Amy Hart' })).toBe('Amy Hart');
    expect(substituteCaption('{event_date}: {performer_name}', { performerName: 'Amy Hart' })).toBe('Amy Hart');
    expect(substituteCaption('at {event_name}', {})).toBe('at'); // only punctuation/whitespace/dashes are trimmed
  });

  it('collapses orphaned separator runs left by dropped tokens', () => {
    expect(substituteCaption('{performer_name} — {performer_city} — {event_name}', { performerName: 'Amy' })).toBe('Amy');
    expect(substituteCaption('{performer_city}, {event_name}', { performerName: 'Amy' })).toBe('');
  });

  it('leaves unknown tokens untouched so typos stay visible', () => {
    expect(substituteCaption('{song_title} by {performer_name}', { performerName: 'Amy Hart' })).toBe('{song_title} by Amy Hart');
  });

  it('trims values and collapses whitespace runs', () => {
    expect(substituteCaption('{performer_name}   live', { performerName: '  Amy  ' })).toBe('Amy live');
  });
});

describe('defaultCaptionEn (server English defaults for OG/alt, §7.2)', () => {
  it('short form: performer + city, or bare performer without a city', () => {
    expect(defaultCaptionEn({ performerName: 'Amy Hart', performerCity: 'Dublin' }, 'short')).toBe('Amy Hart from Dublin');
    expect(defaultCaptionEn({ performerName: 'Amy Hart' }, 'short')).toBe('Amy Hart');
  });

  it('long form composes event and date naturally', () => {
    expect(defaultCaptionEn({ performerName: 'Amy Hart', performerCity: 'Dublin', eventName: 'Friday Stage', eventDate: '15 Dec 2026' }, 'long')).toBe(
      'Amy Hart from Dublin at Friday Stage on 15 Dec 2026',
    );
    expect(defaultCaptionEn({ performerName: 'Amy Hart', eventName: 'Friday Stage' }, 'long')).toBe('Amy Hart at Friday Stage');
    expect(defaultCaptionEn({ performerName: 'Amy Hart', eventDate: '15 Dec 2026' }, 'long')).toBe('Amy Hart on 15 Dec 2026');
  });

  it('free-standing media (no performer) has no default caption', () => {
    expect(defaultCaptionEn({ eventName: 'Friday Stage' }, 'long')).toBe('');
    expect(defaultCaptionEn({}, 'short')).toBe('');
  });
});

describe('resolveCaption / resolveAltText', () => {
  const values = { performerName: 'Amy Hart', performerCity: 'Dublin', eventName: 'Friday Stage' };

  it('organizer captions win over defaults', () => {
    expect(resolveCaption('Great night with {performer_name}', values)).toBe('Great night with Amy Hart');
    expect(resolveCaption(null, values)).toBe('Amy Hart from Dublin');
  });

  it('alt text falls back to "Photo from {event_name}" then the series name', () => {
    expect(resolveAltText({ mediaType: 'photo', caption: null }, { eventName: 'Friday Stage' })).toBe('Photo from Friday Stage');
    expect(resolveAltText({ mediaType: 'photo', caption: null }, { seriesName: 'Nighttown' })).toBe('Photo from Nighttown');
    expect(resolveAltText({ mediaType: 'photo', caption: null }, {})).toBe('Photo from an open mic');
    expect(resolveAltText({ mediaType: 'video', caption: null }, { eventName: 'Friday Stage' })).toBe('Video from Friday Stage');
  });

  it('alt text uses the full substituted caption without a length cap', () => {
    const long = `${'{performer_name}'} ${'x'.repeat(600)}`;
    expect(resolveAltText({ mediaType: 'photo', caption: long }, values)).toBe(`Amy Hart ${'x'.repeat(600)}`);
  });
});

describe('availableCaptionTokens', () => {
  it('lists fewer tokens for free-standing and series-scope media', () => {
    expect(availableCaptionTokens({ attributed: true, eventScoped: true })).toEqual(['performer_name', 'performer_city', 'event_name', 'event_date']);
    expect(availableCaptionTokens({ attributed: false, eventScoped: true })).toEqual(['event_name', 'event_date']);
    expect(availableCaptionTokens({ attributed: false, eventScoped: false })).toEqual([]);
  });
});
