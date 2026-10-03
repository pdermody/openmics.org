import type { Pool, PoolClient } from 'pg';

import { decodeMediaCursor, encodeMediaCursor, type MediaSortMode } from './cursor.js';
import { ValidationError } from '../errors.js';

type Queryable = Pool | PoolClient;

export type MediaRendition = {
  url: string;
  width: number;
  height: number;
  mime_type: string;
  size_bytes: number;
};

export type MediaRenditions = {
  thumb?: MediaRendition;
  grid?: MediaRendition;
  lightbox?: MediaRendition;
  original?: MediaRendition;
};

export type MediaRow = {
  id: string;
  media_type: 'photo' | 'video';
  event_id: string | null;
  open_mic_id: string | null;
  registration_id: string | null;
  added_by_profile_id: string;
  source_url: string;
  mime_type: string | null;
  /** bigint — pg returns it as a string. */
  size_bytes: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  video_platform: 'youtube' | 'vimeo' | null;
  platform_video_id: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  alt_text: string | null;
  renditions: MediaRenditions | null;
  performer_name_snapshot: string | null;
  performer_city_snapshot: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by_profile_id: string | null;
  recovery_deadline: Date | null;
  deletion_reason: 'organizer' | 'consent_revocation' | null;
};

/** A media row joined with everything the public display needs (caption/attribution context). */
export type MediaListRow = MediaRow & {
  event_name: string | null;
  event_starts_at: Date | null;
  event_time_zone: string | null;
  series_name: string | null;
  /** Display name: adopted profile name when adopted, otherwise the publish-time snapshot. */
  attribution_name: string | null;
  /** Always the registration snapshot — profiles carry no city. */
  attribution_city: string | null;
  attribution_profile_id: string | null;
  attribution_handle: string | null;
  /** Present on list queries when sort=shuffle (the row's hash under the active seed). */
  shuffle_key?: string | null;
  /** Present on list queries when sort=newest — full-precision epoch seconds key. */
  newest_key?: string | number | null;
  /** Internal visibility state (never serialized; used by routes and OG injection). */
  event_status: string | null;
  event_deleted_at: Date | null;
  series_id: string | null;
  series_status: string | null;
  series_deleted_at: Date | null;
  series_owner_profile_id: string | null;
  series_handle: string | null;
};

// Every media read joins the event + series (for caption context and visibility) and the
// registration's adopted profile (design §4.2: display name/handle come from the adopted
// profile when one is adopted, otherwise from the publish-time snapshot). Split into
// select-list + FROM so keyset key columns can be appended to the SELECT list.
const MEDIA_SELECT = `
  SELECT m.*,
    e.title AS event_name,
    e.starts_at AS event_starts_at,
    e.time_zone AS event_time_zone,
    e.status AS event_status,
    e.deleted_at AS event_deleted_at,
    om.id AS series_id,
    om.name AS series_name,
    om.status AS series_status,
    om.deleted_at AS series_deleted_at,
    om.owner_profile_id AS series_owner_profile_id,
    om.current_handle AS series_handle,
    COALESCE(ap.profile_name, m.performer_name_snapshot) AS attribution_name,
    m.performer_city_snapshot AS attribution_city,
    ap.id AS attribution_profile_id,
    ap.current_handle AS attribution_handle
`;
const MEDIA_FROM = `
  FROM media m
  LEFT JOIN events e ON e.id = m.event_id
  LEFT JOIN open_mics om ON om.id = COALESCE(m.open_mic_id, e.open_mic_id)
  LEFT JOIN registrations r ON r.id = m.registration_id
  LEFT JOIN profiles ap ON ap.id = r.adopted_profile_id AND ap.deleted_at IS NULL
`;

/** Row-level mirror of PUBLIC_VISIBILITY, for single-row reads and OG injection. */
export function isMediaPubliclyVisible(row: MediaListRow): boolean {
  if (row.deleted_at) return false;
  if (row.series_deleted_at) return false;
  if (row.series_status !== 'active' && row.series_status !== 'paused') return false;
  if (row.event_id !== null && (row.event_deleted_at || row.event_status !== 'published')) return false;
  return true;
}

export type InsertMediaInput = {
  /** Caller-generated: the canonical S3 object key is `original/{id}.{ext}`, so the row id must be known before insert. */
  id: string;
  mediaType: 'photo' | 'video';
  eventId: string | null;
  openMicId: string | null;
  registrationId: string | null;
  addedByProfileId: string;
  sourceUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  videoPlatform: 'youtube' | 'vimeo' | null;
  platformVideoId: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  performerNameSnapshot: string | null;
  performerCitySnapshot: string | null;
};

export async function insertMedia(client: PoolClient, input: InsertMediaInput): Promise<MediaRow> {
  const result = await client.query<MediaRow>(
    `INSERT INTO media (
      id, media_type, event_id, open_mic_id, registration_id, added_by_profile_id,
      source_url, mime_type, size_bytes, video_platform, platform_video_id, thumbnail_url,
      caption, performer_name_snapshot, performer_city_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *`,
    [
      input.id,
      input.mediaType,
      input.eventId,
      input.openMicId,
      input.registrationId,
      input.addedByProfileId,
      input.sourceUrl,
      input.mimeType,
      input.sizeBytes,
      input.videoPlatform,
      input.platformVideoId,
      input.thumbnailUrl,
      input.caption,
      input.performerNameSnapshot,
      input.performerCitySnapshot,
    ],
  );
  return result.rows[0];
}

const MEDIA_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Fetches a media row in any state (including soft-deleted); visibility is a route concern. */
export async function findMediaById(client: Queryable, id: string): Promise<MediaListRow | null> {
  if (!MEDIA_UUID.test(id)) return null;
  const result = await client.query<MediaListRow>(`${MEDIA_SELECT}${MEDIA_FROM} WHERE m.id = $1`, [id]);
  return result.rows[0] ?? null;
}

/** The account that owns the media via its scope's series owner profile. */
export async function findMediaOwnerAccountId(client: Queryable, media: MediaRow): Promise<string | null> {
  const openMicId = media.open_mic_id ?? null;
  const result = await client.query<{ created_by_account_id: string }>(
    `SELECT p.created_by_account_id
     FROM open_mics om JOIN profiles p ON p.id = om.owner_profile_id
     WHERE om.id = COALESCE($1, (SELECT e.open_mic_id FROM events e WHERE e.id = $2))`,
    [openMicId, media.event_id],
  );
  return result.rows[0]?.created_by_account_id ?? null;
}

export async function updateMediaMetadata(
  client: Queryable,
  id: string,
  changes: {
    caption?: string | null;
    registrationId?: string | null;
    performerNameSnapshot?: string | null;
    performerCitySnapshot?: string | null;
  },
): Promise<MediaRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  if (changes.caption !== undefined) {
    sets.push(`caption = $${index++}`);
    values.push(changes.caption);
  }
  if (changes.registrationId !== undefined) {
    sets.push(`registration_id = $${index++}`);
    values.push(changes.registrationId);
    sets.push(`performer_name_snapshot = $${index++}`);
    values.push(changes.performerNameSnapshot ?? null);
    sets.push(`performer_city_snapshot = $${index++}`);
    values.push(changes.performerCitySnapshot ?? null);
  }
  if (sets.length === 0) {
    const current = await client.query<MediaRow>('SELECT * FROM media WHERE id = $1', [id]);
    return current.rows[0] ?? null;
  }
  sets.push('updated_at = now()');
  values.push(id);
  const result = await client.query<MediaRow>(
    `UPDATE media SET ${sets.join(', ')} WHERE id = $${index} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/** Persists rendition metadata reported by the rendition pipeline callback. */
export async function updateMediaRenditions(
  client: Queryable,
  id: string,
  renditions: MediaRenditions,
  dimensions: { width: number; height: number },
): Promise<void> {
  await client.query(
    'UPDATE media SET renditions = $1, width = $2, height = $3, updated_at = now() WHERE id = $4',
    [JSON.stringify(renditions), dimensions.width, dimensions.height, id],
  );
}

export type MediaSoftDeleteInput = {
  deletedByProfileId: string | null;
  reason: 'organizer' | 'consent_revocation';
};

export async function softDeleteMedia(client: Queryable, id: string, input: MediaSoftDeleteInput): Promise<MediaRow | null> {
  const result = await client.query<MediaRow>(
    `UPDATE media
     SET deleted_at = now(), deleted_by_profile_id = $2, recovery_deadline = now() + interval '30 days',
         deletion_reason = $3, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, input.deletedByProfileId, input.reason],
  );
  return result.rows[0] ?? null;
}

export async function recoverMedia(client: Queryable, id: string): Promise<MediaRow | null> {
  const result = await client.query<MediaRow>(
    `UPDATE media
     SET deleted_at = NULL, deleted_by_profile_id = NULL, recovery_deadline = NULL, deletion_reason = NULL, updated_at = now()
     WHERE id = $1 AND deleted_at IS NOT NULL AND recovery_deadline > now()
     RETURNING *`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Consent revocation: retroactive soft-delete of every visible row linked to the registration. */
export async function softDeleteMediaForConsentRevocation(client: PoolClient, registrationId: string): Promise<MediaRow[]> {
  const result = await client.query<MediaRow>(
    `UPDATE media
     SET deleted_at = now(), deleted_by_profile_id = NULL, recovery_deadline = now() + interval '30 days',
         deletion_reason = 'consent_revocation', updated_at = now()
     WHERE registration_id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [registrationId],
  );
  return result.rows;
}

/** Consent restoration: restores ONLY rows deleted solely for the revocation, while the window is open. */
export async function restoreConsentRevokedMedia(client: PoolClient, registrationId: string): Promise<MediaRow[]> {
  const result = await client.query<MediaRow>(
    `UPDATE media
     SET deleted_at = NULL, deleted_by_profile_id = NULL, recovery_deadline = NULL, deletion_reason = NULL, updated_at = now()
     WHERE registration_id = $1 AND deleted_at IS NOT NULL
       AND deletion_reason = 'consent_revocation' AND recovery_deadline > now()
     RETURNING *`,
    [registrationId],
  );
  return result.rows;
}

export type PendingDeletionInput = {
  bucket: string;
  objectKey: string;
  mediaId: string | null;
  reason: 'purge' | 'replace' | 'abandoned_upload' | 'manual';
  scheduledFor: Date;
};

export async function insertPendingDeletion(client: Queryable, input: PendingDeletionInput): Promise<void> {
  await client.query(
    `INSERT INTO pending_s3_deletions (bucket, object_key, media_id, reason, scheduled_for)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.bucket, input.objectKey, input.mediaId, input.reason, input.scheduledFor],
  );
}

/** Cancels not-yet-processed deletions for a media item (used by recovery/consent restore). */
export async function cancelPendingDeletionsForMedia(client: Queryable, mediaId: string): Promise<void> {
  await client.query('DELETE FROM pending_s3_deletions WHERE media_id = $1 AND processed_at IS NULL', [mediaId]);
}

export async function removeFeaturedPinsForMedia(client: Queryable, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  await client.query('DELETE FROM open_mic_featured_media WHERE media_id = ANY($1::uuid[])', [mediaIds]);
}

// ---------------------------------------------------------------------------
// Keyset-paginated listings
// ---------------------------------------------------------------------------

export type MediaListQuery = {
  type: 'all' | 'photo' | 'video';
  sort: MediaSortMode;
  seed?: number;
  anchor?: string;
  cursor?: string;
  limit: number;
  /**
   * Owner/manage view: skips the public-visibility filters (draft events, non-public
   * series) but still excludes soft-deleted rows — those live behind
   * findRecentlyDeletedMediaForAccount.
   */
  includePubliclyHidden?: boolean;
};

export type MediaListPage = {
  rows: MediaListRow[];
  prevCursor: string | null;
  nextCursor: string | null;
};

function effectiveSort(sort: MediaSortMode): 'newest' | 'shuffle' {
  // `most_liked` is accepted for forward compatibility and behaves like `newest` until
  // reactions ship (openapi.yaml → MediaSort).
  return sort === 'shuffle' ? 'shuffle' : 'newest';
}

/**
 * Public visibility: media not soft-deleted; event media requires a published,
 * non-deleted event in a non-deleted active/paused series; series free-standing media
 * requires a non-deleted active/paused series. (Directory parity: draft/ended series
 * are not public surfaces.)
 */
const PUBLIC_VISIBILITY = `
  m.deleted_at IS NULL
  AND om.deleted_at IS NULL AND om.status IN ('active', 'paused')
  AND (m.event_id IS NULL OR (e.deleted_at IS NULL AND e.status = 'published'))
`;

function buildListQuery(scopeWhere: string, scopeParams: unknown[], query: MediaListQuery) {
  const sort = effectiveSort(query.sort);
  const seed = query.seed ?? 0;
  const params: unknown[] = [...scopeParams];
  const conditions: string[] = [scopeWhere];
  conditions.push(query.includePubliclyHidden ? 'm.deleted_at IS NULL' : PUBLIC_VISIBILITY);
  if (query.type !== 'all') {
    params.push(query.type);
    conditions.push(`m.media_type = $${params.length}`);
  }
  // The shuffle key is a per-row md5 over (id, seed): deterministic within a session,
  // reshuffled on refresh when the client picks a new seed (design §11.1).
  let seedParam = '';
  if (sort === 'shuffle') {
    params.push(String(seed));
    seedParam = `$${params.length}`;
  }
  const shuffleKeyExpr = `md5(m.id::text || ':' || ${seedParam})`;
  // Keyset keys must carry Postgres' full microsecond precision — JS Dates truncate to
  // milliseconds, which would make a row compare newer than its own cursor key. The
  // `newest` key is therefore EXTRACT(EPOCH) (numeric, μs-exact); `shuffle` keys are the
  // md5 hex hashes (text).
  const keyExpr = sort === 'shuffle' ? shuffleKeyExpr : 'EXTRACT(EPOCH FROM m.created_at)';
  const keyCast = sort === 'shuffle' ? '' : '::float8';
  const keySelect = sort === 'shuffle' ? `, ${shuffleKeyExpr} AS shuffle_key` : `, EXTRACT(EPOCH FROM m.created_at) AS newest_key`;
  const orderDesc = sort === 'shuffle' ? `${shuffleKeyExpr} DESC, m.id DESC` : 'm.created_at DESC, m.id DESC';
  const orderAsc = sort === 'shuffle' ? `${shuffleKeyExpr} ASC, m.id ASC` : 'm.created_at ASC, m.id ASC';
  return { sort, seed, params, conditions, keyExpr, keyCast, keySelect, orderDesc, orderAsc };
}

function keyPredicate(sort: 'newest' | 'shuffle', keyExpr: string, keyCast: string, direction: 'next' | 'prev', key: string, id: string, params: unknown[]): string {
  const operator = direction === 'next' ? '<' : '>';
  params.push(key, id);
  const keyParam = `$${params.length - 1}${keyCast}`;
  const idParam = `$${params.length}`;
  // Rows are ordered key DESC, id DESC, so "next" (older) is strictly smaller.
  return `(${keyExpr} ${operator} ${keyParam} OR (${keyExpr} = ${keyParam} AND m.id ${operator} ${idParam}))`;
}

function rowKey(row: MediaListRow, sort: 'newest' | 'shuffle'): string {
  if (sort === 'shuffle') return row.shuffle_key ?? '';
  return String(row.newest_key ?? '');
}

export async function listScopedMedia(
  client: Queryable,
  scopeWhere: string,
  scopeParams: unknown[],
  query: MediaListQuery,
): Promise<MediaListPage> {
  const { sort, seed, params, conditions, keyExpr, keyCast, keySelect, orderDesc, orderAsc } = buildListQuery(scopeWhere, scopeParams, query);
  const where = conditions.join(' AND ');
  const shuffleSelect = keySelect;

  if (query.cursor && query.anchor) {
    throw new ValidationError('cursor and anchor cannot be combined', { field: 'anchor' });
  }

  let rows: MediaListRow[];

  if (query.anchor) {
    // Anchor must resolve inside this scope under the same visibility rules.
    const anchorParams = [...params, query.anchor];
    const anchorResult = await client.query<MediaListRow>(
      `${MEDIA_SELECT}${shuffleSelect}${MEDIA_FROM} WHERE ${where} AND m.id = $${anchorParams.length}`,
      anchorParams,
    );
    const anchorRow = anchorResult.rows[0];
    if (!anchorRow) return { rows: [], prevCursor: null, nextCursor: null };

    const anchorKey = rowKey(anchorRow, sort);
    const halfNewer = Math.floor(query.limit / 2);
    const newerParams = [...params];
    const newerPredicate = keyPredicate(sort, keyExpr, keyCast, 'prev', anchorKey, anchorRow.id, newerParams);
    const newer = await client.query<MediaListRow>(
      `${MEDIA_SELECT}${shuffleSelect}${MEDIA_FROM} WHERE ${where} AND ${newerPredicate} ORDER BY ${orderAsc} LIMIT ${halfNewer}`,
      newerParams,
    );
    const olderParams = [...params];
    const olderKeyParam = `$${olderParams.length + 1}${keyCast}`;
    const olderPredicate = `(${keyExpr} < ${olderKeyParam} OR (${keyExpr} = ${olderKeyParam} AND m.id <= $${olderParams.length + 2}))`;
    olderParams.push(anchorKey, anchorRow.id);
    const older = await client.query<MediaListRow>(
      `${MEDIA_SELECT}${shuffleSelect}${MEDIA_FROM} WHERE ${where} AND ${olderPredicate} ORDER BY ${orderDesc} LIMIT ${query.limit - halfNewer}`,
      olderParams,
    );
    rows = [...newer.rows.reverse(), ...older.rows];
  } else if (query.cursor) {
    const cursor = decodeMediaCursor(query.cursor);
    if (!cursor || cursor.s !== sort || (sort === 'shuffle' && cursor.e !== seed)) {
      throw new ValidationError('Invalid media cursor', { field: 'cursor' });
    }
    const direction = cursor.d;
    const cursorParams = [...params];
    const predicate = keyPredicate(sort, keyExpr, keyCast, direction, cursor.k, cursor.i, cursorParams);
    const order = direction === 'next' ? orderDesc : orderAsc;
    const result = await client.query<MediaListRow>(
      `${MEDIA_SELECT}${shuffleSelect}${MEDIA_FROM} WHERE ${where} AND ${predicate} ORDER BY ${order} LIMIT ${query.limit}`,
      cursorParams,
    );
    rows = direction === 'next' ? result.rows : result.rows.reverse();
  } else {
    const result = await client.query<MediaListRow>(
      `${MEDIA_SELECT}${shuffleSelect}${MEDIA_FROM} WHERE ${where} ORDER BY ${orderDesc} LIMIT ${query.limit}`,
      params,
    );
    rows = result.rows;
  }

  // Existence probes decide both cursors, so an exact page boundary never yields a
  // dangling cursor into an empty page.
  let prevCursor: string | null = null;
  let nextCursor: string | null = null;
  if (rows.length > 0) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const newerParams = [...params];
    const newerProbe = keyPredicate(sort, keyExpr, keyCast, 'prev', rowKey(first, sort), first.id, newerParams);
    const hasNewer = await client.query(
      `SELECT 1 FROM media m
       LEFT JOIN events e ON e.id = m.event_id
       LEFT JOIN open_mics om ON om.id = COALESCE(m.open_mic_id, e.open_mic_id)
       LEFT JOIN registrations r ON r.id = m.registration_id
       WHERE ${where} AND ${newerProbe} LIMIT 1`,
      newerParams,
    );
    const olderParams = [...params];
    const olderProbe = keyPredicate(sort, keyExpr, keyCast, 'next', rowKey(last, sort), last.id, olderParams);
    const hasOlder = await client.query(
      `SELECT 1 FROM media m
       LEFT JOIN events e ON e.id = m.event_id
       LEFT JOIN open_mics om ON om.id = COALESCE(m.open_mic_id, e.open_mic_id)
       LEFT JOIN registrations r ON r.id = m.registration_id
       WHERE ${where} AND ${olderProbe} LIMIT 1`,
      olderParams,
    );
    if (hasNewer.rows.length > 0) {
      prevCursor = encodeMediaCursor({ s: sort, e: sort === 'shuffle' ? seed : undefined, d: 'prev', k: rowKey(first, sort), i: first.id });
    }
    if (hasOlder.rows.length > 0) {
      nextCursor = encodeMediaCursor({ s: sort, e: sort === 'shuffle' ? seed : undefined, d: 'next', k: rowKey(last, sort), i: last.id });
    }
  }

  return { rows, prevCursor, nextCursor };
}

export async function listEventMedia(client: Queryable, eventId: string, query: MediaListQuery): Promise<MediaListPage> {
  return listScopedMedia(client, 'm.event_id = $1', [eventId], query);
}

export async function listOpenMicMedia(client: Queryable, openMicId: string, query: MediaListQuery): Promise<MediaListPage> {
  // Series gallery = free-standing series media UNION media on this series' events.
  return listScopedMedia(client, '(m.open_mic_id = $1 OR e.open_mic_id = $1)', [openMicId], query);
}

export async function listProfileMedia(client: Queryable, profileId: string, query: MediaListQuery): Promise<MediaListPage> {
  // Derived performer gallery: event media whose registration currently adopts this profile.
  return listScopedMedia(client, 'r.adopted_profile_id = $1', [profileId], query);
}

export async function countEventMediaByType(client: Queryable, eventId: string, mediaType: 'photo' | 'video'): Promise<number> {
  const result = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM media WHERE event_id = $1 AND media_type = $2 AND deleted_at IS NULL',
    [eventId, mediaType],
  );
  return Number(result.rows[0].count);
}

/**
 * Byte backstop accounting (decisions.md): counts every photo byte the account still
 * holds — non-deleted rows plus soft-deleted rows whose bytes remain until the purge.
 */
export async function sumAccountMediaBytes(client: Queryable, accountId: string): Promise<number> {
  const result = await client.query<{ total: string | null }>(
    `SELECT COALESCE(sum(m.size_bytes), 0)::text AS total
     FROM media m
     JOIN profiles p ON p.id = m.added_by_profile_id
     WHERE p.created_by_account_id = $1
       AND m.media_type = 'photo'
       AND (m.deleted_at IS NULL OR m.recovery_deadline > now())`,
    [accountId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Featured pins
// ---------------------------------------------------------------------------

export async function listFeaturedMedia(client: Queryable, openMicId: string, includePubliclyHidden: boolean): Promise<MediaListRow[]> {
  const visibility = includePubliclyHidden ? 'm.deleted_at IS NULL' : PUBLIC_VISIBILITY;
  const result = await client.query<MediaListRow>(
    `${MEDIA_SELECT}${MEDIA_FROM}
     JOIN open_mic_featured_media f ON f.media_id = m.id
     WHERE f.open_mic_id = $1 AND ${visibility}
     ORDER BY f.position ASC`,
    [openMicId],
  );
  return result.rows;
}

/** Atomically replaces a series' featured pins; positions follow the array order. */
export async function replaceFeaturedMedia(client: PoolClient, openMicId: string, mediaIds: string[]): Promise<void> {
  await client.query('DELETE FROM open_mic_featured_media WHERE open_mic_id = $1', [openMicId]);
  for (const [position, mediaId] of mediaIds.entries()) {
    await client.query(
      'INSERT INTO open_mic_featured_media (open_mic_id, media_id, position) VALUES ($1, $2, $3)',
      [openMicId, mediaId, position],
    );
  }
}

// ---------------------------------------------------------------------------
// Recently deleted (organizer manage view)
// ---------------------------------------------------------------------------

export type RecentlyDeletedRow = MediaListRow & {
  owner_open_mic_id: string;
  owner_open_mic_name: string;
  /** Full-precision epoch of deleted_at, selected for cursor keys. */
  deleted_at_epoch: string | number;
};

export async function findRecentlyDeletedMediaForAccount(
  client: Queryable,
  accountId: string,
  options: { cursor?: string; limit: number },
): Promise<{ rows: RecentlyDeletedRow[]; nextCursor: string | null }> {
  const params: unknown[] = [accountId];
  let cursorPredicate = '';
  if (options.cursor) {
    const cursor = decodeMediaCursor(options.cursor);
    if (!cursor || cursor.s !== 'newest') throw new ValidationError('Invalid media cursor', { field: 'cursor' });
    params.push(cursor.k, cursor.i);
    // Full-precision epoch keys (see listScopedMedia) — ISO strings truncate to ms and
    // would re-return the page's last row.
    cursorPredicate = `AND (EXTRACT(EPOCH FROM m.deleted_at) < $2::float8 OR (EXTRACT(EPOCH FROM m.deleted_at) = $2::float8 AND m.id < $3))`;
  }
  params.push(options.limit + 1);
  const limitParam = `$${params.length}`;
  const result = await client.query<RecentlyDeletedRow>(
    `SELECT m.*,
       e.title AS event_name,
       e.starts_at AS event_starts_at,
       e.time_zone AS event_time_zone,
       e.status AS event_status,
       e.deleted_at AS event_deleted_at,
       om.id AS series_id,
       om.name AS series_name,
       om.status AS series_status,
       om.deleted_at AS series_deleted_at,
       om.owner_profile_id AS series_owner_profile_id,
       om.current_handle AS series_handle,
       COALESCE(ap.profile_name, m.performer_name_snapshot) AS attribution_name,
       m.performer_city_snapshot AS attribution_city,
       ap.id AS attribution_profile_id,
       ap.current_handle AS attribution_handle,
       om.id AS owner_open_mic_id,
       om.name AS owner_open_mic_name,
       EXTRACT(EPOCH FROM m.deleted_at) AS deleted_at_epoch
     FROM media m
     LEFT JOIN events e ON e.id = m.event_id
     JOIN open_mics om ON om.id = COALESCE(m.open_mic_id, e.open_mic_id)
     LEFT JOIN registrations r ON r.id = m.registration_id
     LEFT JOIN profiles ap ON ap.id = r.adopted_profile_id AND ap.deleted_at IS NULL
     WHERE om.owner_profile_id IN (SELECT id FROM profiles WHERE created_by_account_id = $1 AND deleted_at IS NULL)
       AND m.deleted_at IS NOT NULL AND m.recovery_deadline > now()
       ${cursorPredicate}
     ORDER BY m.deleted_at DESC, m.id DESC
     LIMIT ${limitParam}`,
    params,
  );
  const hasMore = result.rows.length > options.limit;
  const rows = hasMore ? result.rows.slice(0, options.limit) : result.rows;
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last
    ? encodeMediaCursor({ s: 'newest', d: 'next', k: String(last.deleted_at_epoch), i: last.id })
    : null;
  return { rows, nextCursor };
}