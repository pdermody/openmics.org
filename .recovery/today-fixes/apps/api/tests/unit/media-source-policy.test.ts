import { describe, expect, it } from 'vitest';

import {
  canonicalVideoUrl,
  validatePhotoSourceKey,
  validateVideoUrl,
  videoThumbnailUrl,
} from '../../src/media/source-policy.js';

const ACCOUNT = 'a0000000-0000-0000-0000-000000000001';
const OTHER = 'b0000000-0000-0000-0000-000000000002';

describe('validatePhotoSourceKey', () => {
  it('accepts a well-formed pending upload key owned by the account', () => {
    expect(() => validatePhotoSourceKey(`tmp/${ACCOUNT}/c0000000-0000-0000-0000-000000000003.jpg`, ACCOUNT)).not.toThrow();
    expect(() => validatePhotoSourceKey(`tmp/${ACCOUNT}/c0000000-0000-0000-0000-000000000003.png`, ACCOUNT)).not.toThrow();
    expect(() => validatePhotoSourceKey(`tmp/${ACCOUNT}/c0000000-0000-0000-0000-000000000003.webp`, ACCOUNT)).not.toThrow();
  });

  it('rejects keys owned by another account (no cross-account commit of pending uploads)', () => {
    expect(() => validatePhotoSourceKey(`tmp/${OTHER}/c0000000-0000-0000-0000-000000000003.jpg`, ACCOUNT)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_SOURCE_POLICY' }),
    );
  });

  it('rejects non-tmp keys, traversal, and non-photo extensions', () => {
    for (const key of [
      `original/${ACCOUNT}/c0000000-0000-0000-0000-000000000003.jpg`,
      `tmp/${ACCOUNT}/c0000000-0000-0000-0000-000000000003.gif`,
      `tmp/${ACCOUNT}/../../etc/passwd.jpg`,
      `tmp/${ACCOUNT}/not-a-uuid.jpg`,
      'https://evil.example/photo.jpg',
      `tmp/${ACCOUNT}/c0000000-0000-0000-0000-000000000003`,
    ]) {
      expect(() => validatePhotoSourceKey(key, ACCOUNT)).toThrowError(expect.objectContaining({ code: 'MEDIA_SOURCE_POLICY' }));
    }
  });
});

describe('validateVideoUrl', () => {
  it('parses YouTube watch, share, embed, and shorts URLs', () => {
    const expected = { platform: 'youtube', platformVideoId: 'dQw4w9WgXcQ' };
    expect(validateVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected);
    expect(validateVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual(expected);
    expect(validateVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual(expected);
    expect(validateVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual(expected);
    expect(validateVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')).toEqual(expected);
  });

  it('parses Vimeo video and player URLs', () => {
    expect(validateVideoUrl('https://vimeo.com/123456789')).toEqual({ platform: 'vimeo', platformVideoId: '123456789' });
    expect(validateVideoUrl('https://player.vimeo.com/video/123456789')).toEqual({ platform: 'vimeo', platformVideoId: '123456789' });
  });

  it('rejects non-allowlisted hosts and malformed URLs', () => {
    for (const url of [
      'https://www.tiktok.com/@user/video/123',
      'https://www.instagram.com/reel/abc/',
      'https://www.twitch.tv/videos/123',
      'https://evil-youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=',
      'not-a-url',
      'ftp://youtu.be/dQw4w9WgXcQ',
    ]) {
      expect(() => validateVideoUrl(url)).toThrowError(expect.objectContaining({ code: 'MEDIA_SOURCE_POLICY' }));
    }
  });

  it('composes canonical URLs and provider-CDN thumbnails', () => {
    expect(canonicalVideoUrl({ platform: 'youtube', platformVideoId: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(canonicalVideoUrl({ platform: 'vimeo', platformVideoId: '123456789' })).toBe('https://vimeo.com/123456789');
    expect(videoThumbnailUrl({ platform: 'youtube', platformVideoId: 'dQw4w9WgXcQ' })).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(videoThumbnailUrl({ platform: 'vimeo', platformVideoId: '123456789' })).toBe('https://vumbnail.com/123456789.jpg');
  });
});
