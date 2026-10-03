// Opaque keyset cursors for media listings (media-gallery-plan.md Phase 5). A cursor
// encodes the sort mode, the shuffle seed, the direction of travel, and the key of the
// row to continue from, so a cursor is meaningless (and rejected) under a different
// sort/seed. Base64url(JSON) — opaque to clients, stable across requests.

export type MediaSortMode = 'newest' | 'shuffle' | 'most_liked';

export type MediaCursorPayload = {
  /** Effective sort (`most_liked` aliases `newest` until reactions ship). */
  s: 'newest' | 'shuffle';
  /** Shuffle seed (only for s='shuffle'). */
  e?: number;
  /** Direction of travel this cursor pages towards. */
  d: 'next' | 'prev';
  /** Row key: ISO created_at for newest, the row's shuffle hash for shuffle. */
  k: string;
  /** Row id (tie-breaker). */
  i: string;
};

export function encodeMediaCursor(payload: MediaCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Returns null for malformed cursors; callers turn that into a 400. */
export function decodeMediaCursor(raw: string): MediaCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<MediaCursorPayload>;
    if ((parsed.s !== 'newest' && parsed.s !== 'shuffle') || (parsed.d !== 'next' && parsed.d !== 'prev')) return null;
    if (typeof parsed.k !== 'string' || typeof parsed.i !== 'string') return null;
    if (parsed.s === 'shuffle' && typeof parsed.e !== 'number') return null;
    return parsed as MediaCursorPayload;
  } catch {
    return null;
  }
}
