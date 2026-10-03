import { MediaSourcePolicyError } from '../errors.js';

// Server-side media source policy (decisions.md → Media): photos must be objects in the
// platform's own media bucket uploaded through the upload-url flow (a server-generated
// `tmp/{accountId}/{uuid}.{ext}` key); videos must link to an allowlisted host
// (youtube.com, youtu.be, vimeo.com). Arbitrary hosts are rejected.

export const PHOTO_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const TMP_KEY_PATTERN = /^tmp\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|jpeg|png|webp)$/;

/**
 * Asserts the object key is a well-formed pending upload owned by the given account.
 * Ownership binding matters: without it, an organizer could commit another account's
 * pending upload (or any bucket object whose key they guessed) into their own gallery.
 */
export function validatePhotoSourceKey(objectKey: string, ownerAccountId: string): void {
  const match = TMP_KEY_PATTERN.exec(objectKey);
  if (!match || match[1] !== ownerAccountId) {
    throw new MediaSourcePolicyError('object_key is not a pending upload issued to this account.');
  }
}

export type VideoSource = {
  platform: 'youtube' | 'vimeo';
  platformVideoId: string;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;

/** Parses an allowlisted video URL into its platform + canonical id; rejects anything else. */
export function validateVideoUrl(rawUrl: string): VideoSource {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MediaSourcePolicyError('video_url is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MediaSourcePolicyError('video_url must be an http(s) URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    if (YOUTUBE_ID.test(id)) return { platform: 'youtube', platformVideoId: id };
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const watchId = url.searchParams.get('v') ?? '';
    if (url.pathname === '/watch' && YOUTUBE_ID.test(watchId)) {
      return { platform: 'youtube', platformVideoId: watchId };
    }
    const embedMatch = /^\/(embed|shorts|live)\/([^/?#]+)/.exec(url.pathname);
    if (embedMatch && YOUTUBE_ID.test(embedMatch[2])) {
      return { platform: 'youtube', platformVideoId: embedMatch[2] };
    }
  }
  if (host === 'vimeo.com') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    if (VIMEO_ID.test(id)) return { platform: 'vimeo', platformVideoId: id };
  }
  if (host === 'player.vimeo.com') {
    const embedMatch = /^\/video\/([0-9]{6,12})/.exec(url.pathname);
    if (embedMatch) return { platform: 'vimeo', platformVideoId: embedMatch[1] };
  }

  throw new MediaSourcePolicyError('video_url must link to youtube.com, youtu.be, or vimeo.com.');
}

/** Canonical provider URL stored in Media.source_url for videos. */
export function canonicalVideoUrl(source: VideoSource): string {
  return source.platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${source.platformVideoId}`
    : `https://vimeo.com/${source.platformVideoId}`;
}

/** Provider-CDN thumbnail (decisions.md → Media delivery: thumbnails are hotlinked). */
export function videoThumbnailUrl(source: VideoSource): string {
  return source.platform === 'youtube'
    ? `https://i.ytimg.com/vi/${source.platformVideoId}/hqdefault.jpg`
    : `https://vumbnail.com/${source.platformVideoId}.jpg`;
}
