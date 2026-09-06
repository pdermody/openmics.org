import { describe, expect, it } from 'vitest';

import { slugifyDisplayName } from '../../src/handles/slugify.js';

describe('slugifyDisplayName', () => {
  it.each([
    ['Portlaoise Spotlight Sessions', 'portlaoise-spotlight-sessions'],
    ['Paul Dermody', 'paul-dermody'],
    ['Nighttown, Galway', 'nighttown-galway'],
    ["Sarah's Open Mic!", 'sarahs-open-mic'],
    ['Café del Mar', 'cafe-del-mar'],
    ["The Open Mic @ McGrath's", 'the-open-mic-at-mcgraths'],
  ])('slugifies %s to %s', (input, expected) => {
    expect(slugifyDisplayName(input)).toBe(expected);
  });

  it('appends a random suffix when the result would be too short', () => {
    expect(slugifyDisplayName('!!', () => 'x7k2')).toBe('handle-x7k2');
  });

  it('appends a random suffix when the result is all digits', () => {
    expect(slugifyDisplayName('12345', () => 'x7k2')).toBe('12345-x7k2');
  });

  it('truncates at a hyphen boundary past 50 characters', () => {
    const result = slugifyDisplayName('a'.repeat(48) + ' b');
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('-')).toBe(false);
  });
});
