import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { createLocalMediaStorageAdapter, createLocalRenditionsQueueAdapter, type LocalMediaStorageAdapter, type LocalRenditionsQueueAdapter } from '../../src/media/index.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

// Behavioral coverage for the media pipeline against real Postgres (migrations 019/020
// applied by the test container): upload commit, visibility rules, consent revocation and
// restoration, soft-delete/recovery, Featured pins, anchor pagination, and plan caps.
describe('media pipeline (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let ownerAccountId: string;
  let organizerProfileId: string;
  let openMicId: string;
  let eventId: string;
  let registrationId: string;
  let mediaStorage: LocalMediaStorageAdapter;
  let renditionsQueue: LocalRenditionsQueueAdapter;

  const auth = { authorization: 'Bearer media-owner' };
  const otherAuth = { authorization: 'Bearer media-other' };

  const app = () =>
    buildApp({
      db: pool,
      logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
      mediaStorage,
      renditionsQueue,
    });

  /** Full photo upload flow: reserve → simulate the PUT → commit. */
  async function uploadPhoto(instance: ReturnType<typeof app>, input: { event_id?: string; open_mic_id?: string; registration_id?: string; caption?: string }) {
    const reserve = await instance.inject({
      method: 'POST',
      url: '/api/media/upload-url',
      headers: auth,
      payload: { media_type: 'photo', mime_type: 'image/jpeg', size_bytes: 2048 },
    });
    expect(reserve.statusCode).toBe(200);
    const { object_key } = reserve.json();
    mediaStorage.simulateUpload(object_key, { sizeBytes: 2048, contentType: 'image/jpeg' });
    return instance.inject({
      method: 'POST',
      url: '/api/media',
      headers: auth,
      payload: { media_type: 'photo', object_key, ...input },
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    mediaStorage = createLocalMediaStorageAdapter();
    renditionsQueue = createLocalRenditionsQueueAdapter();

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('media-owner', 'media-owner@example.test') RETURNING id",
    );
    ownerAccountId = owner.rows[0].id;
    const organizerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Media Organizer', 'organizer') RETURNING id",
      [ownerAccountId],
    );
    organizerProfileId = organizerProfile.rows[0].id;
    await pool.query(
      "INSERT INTO accounts (cognito_id, email) VALUES ('media-other', 'media-other@example.test') RETURNING id",
    );

    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, venue_name, address_line1, city, country, time_zone, activities, age_policy, registration_mode, status)
       VALUES ($1, 'Media Open Mic', 'Media Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin', ARRAY['singing'], 'both', 'both', 'active')
       RETURNING id`,
      [organizerProfileId],
    );
    openMicId = openMic.rows[0].id;
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, capacity)
       VALUES ($1, 'Media Night', now() + interval '7 days', now() + interval '7 days 3 hours', 'published', 'Europe/Dublin', 'Media Venue', '1 Test Street', 'Dublin', 'IE', 40)
       RETURNING id`,
      [openMicId],
    );
    eventId = event.rows[0].id;
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id, performer_name, performer_city, contact_email, submission_channel, organizer_supervised, media_consent, verification_method, email_verified_at)
       VALUES ($1, 'Amy Hart', 'Dublin', 'amy@example.test', 'organic', false, true, 'email', now())
       RETURNING id`,
      [eventId],
    );
    registrationId = registration.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('applies the media migrations (019/020)', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('media', 'pending_s3_deletions', 'open_mic_featured_media')`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual(['media', 'open_mic_featured_media', 'pending_s3_deletions']);
    const profileColumn = await pool.query(`SELECT show_gig_media FROM profiles LIMIT 1`);
    expect(profileColumn.rows[0].show_gig_media).toBe(true);
  });

  it('commits a photo end-to-end: reserve, put, commit, list, read', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, registration_id: registrationId, caption: '{performer_name} live' });
    expect(commit.statusCode).toBe(201);
    const media = commit.json();
    expect(media.source_url).toMatch(/^https:\/\/media\.test\/original\//);
    expect(media.attribution).toMatchObject({ performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null });
    expect(media.alt_text).toBe('Amy Hart live');
    expect(media.renditions).toBeNull();
    expect(renditionsQueue.enqueued).toHaveLength(1);
    expect(renditionsQueue.enqueued[0].mediaId).toBe(media.id);

    // The tmp object moved to its canonical key.
    expect([...mediaStorage.objects.keys()]).toEqual([expect.stringMatching(/^original\//)]);

    const list = await instance.inject({ method: 'GET', url: `/api/events/${eventId}/media` });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().next_cursor).toBeNull();

    const read = await instance.inject({ method: 'GET', url: `/api/media/${media.id}` });
    expect(read.statusCode).toBe(200);
    await instance.close();
  });

  it('adds a video link with provider metadata composed server-side', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/media`,
      headers: auth,
      payload: { media_type: 'video', video_url: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    expect(response.statusCode).toBe(201);
    const media = response.json();
    expect(media.video_platform).toBe('youtube');
    expect(media.platform_video_id).toBe('dQw4w9WgXcQ');
    expect(media.source_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(media.thumbnail_url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    // Videos never enqueue rendition jobs.
    expect(renditionsQueue.enqueued).toHaveLength(1);
    await instance.close();
  });

  it('rejects video links to non-allowlisted hosts', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/media`,
      headers: auth,
      payload: { media_type: 'video', video_url: 'https://www.tiktok.com/@x/video/123' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('MEDIA_SOURCE_POLICY');
    await instance.close();
  });

  it('rejects photo commits for objects that were never uploaded or belong to another account', async () => {
    const instance = app();
    const reserve = await instance.inject({
      method: 'POST', url: '/api/media/upload-url', headers: auth,
      payload: { media_type: 'photo', mime_type: 'image/png', size_bytes: 100 },
    });
    const { object_key } = reserve.json();
    // Never uploaded → stat fails.
    const missing = await instance.inject({
      method: 'POST', url: '/api/media', headers: auth,
      payload: { media_type: 'photo', object_key, event_id: eventId },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('MEDIA_SOURCE_POLICY');

    // Upload into another account's tmp prefix → key binding rejects.
    mediaStorage.simulateUpload(`tmp/a0000000-dead-0000-0000-000000000000/c0000000-0000-0000-0000-000000000003.png`, { sizeBytes: 100, contentType: 'image/png' });
    const foreign = await instance.inject({
      method: 'POST', url: '/api/media', headers: auth,
      payload: { media_type: 'photo', object_key: 'tmp/a0000000-dead-0000-0000-0000-000000000000/c0000000-0000-0000-0000-000000000003.png', event_id: eventId },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.code).toBe('MEDIA_SOURCE_POLICY');
    await instance.close();
  });

  it('enforces ownership: non-owners cannot add, edit, delete, or pin media', async () => {
    const instance = app();
    const list = await instance.inject({ method: 'GET', url: `/api/events/${eventId}/media` });
    const mediaId = list.json().items[0].id;

    const patchAsOther = await instance.inject({ method: 'PATCH', url: `/api/media/${mediaId}`, headers: otherAuth, payload: { caption: 'Hijack' } });
    expect(patchAsOther.statusCode).toBe(403);
    const deleteAsOther = await instance.inject({ method: 'DELETE', url: `/api/media/${mediaId}`, headers: otherAuth });
    expect(deleteAsOther.statusCode).toBe(403);
    const createAsOther = await instance.inject({
      method: 'POST', url: `/api/events/${eventId}/media`, headers: otherAuth,
      payload: { media_type: 'video', video_url: 'https://vimeo.com/123456789' },
    });
    expect(createAsOther.statusCode).toBe(403);
    const pinAsOther = await instance.inject({
      method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: otherAuth, payload: { media_ids: [mediaId] },
    });
    expect(pinAsOther.statusCode).toBe(403);
    await instance.close();
  });

  it('hides media on draft events from the public but shows it to the owner (staging)', async () => {
    const draftEvent = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, capacity)
       VALUES ($1, 'Draft Night', now() + interval '14 days', now() + interval '14 days 3 hours', 'draft', 'Europe/Dublin', 'Media Venue', '1 Test Street', 'Dublin', 'IE', 40)
       RETURNING id`,
      [openMicId],
    );
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: draftEvent.rows[0].id });
    expect(commit.statusCode).toBe(201);

    const publicList = await instance.inject({ method: 'GET', url: `/api/events/${draftEvent.rows[0].id}/media` });
    expect(publicList.statusCode).toBe(404);
    const publicRead = await instance.inject({ method: 'GET', url: `/api/media/${commit.json().id}` });
    expect(publicRead.statusCode).toBe(404);
    expect(publicRead.json().error.code).toBe('MEDIA_HIDDEN');

    const ownerList = await instance.inject({ method: 'GET', url: `/api/events/${draftEvent.rows[0].id}/media`, headers: auth });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().items).toHaveLength(1);
    await instance.close();
  });

  it('consent revocation hides media retroactively; restoration recovers it; organizer deletes stay deleted', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, registration_id: registrationId });
    expect(commit.statusCode).toBe(201);
    const mediaId = commit.json().id;

    // Pin it so we can verify consent revocation also drops Featured pins.
    const pin = await instance.inject({ method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: auth, payload: { media_ids: [mediaId] } });
    expect(pin.statusCode).toBe(200);

    // New attribution to a consent-revoked registration is blocked.
    await pool.query('UPDATE registrations SET media_consent = false WHERE id = $1', [registrationId]);
    const blocked = await instance.inject({
      method: 'POST', url: '/api/media', headers: auth,
      payload: { media_type: 'video', video_url: 'https://vimeo.com/987654321', event_id: eventId, registration_id: registrationId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('MEDIA_CONSENT_REVOKED');
    await pool.query('UPDATE registrations SET media_consent = true WHERE id = $1', [registrationId]);

    // Revoke through the real PATCH flow → media soft-deleted with consent reason.
    const revoke = await instance.inject({ method: 'PATCH', url: `/api/registrations/${registrationId}`, headers: auth, payload: { media_consent: false } });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().media_consent_updated_at).not.toBeNull();

    const afterRevoke = await instance.inject({ method: 'GET', url: `/api/media/${mediaId}` });
    expect(afterRevoke.statusCode).toBe(404);
    expect(afterRevoke.json().error.code).toBe('MEDIA_HIDDEN');
    const row = await pool.query<{ deletion_reason: string; deleted_at: Date | null }>('SELECT deletion_reason, deleted_at FROM media WHERE id = $1', [mediaId]);
    expect(row.rows[0].deletion_reason).toBe('consent_revocation');
    const pending = await pool.query('SELECT object_key, reason FROM pending_s3_deletions WHERE media_id = $1', [mediaId]);
    expect(pending.rows.length).toBeGreaterThan(0);
    expect(pending.rows[0].reason).toBe('purge');
    const featured = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}/featured-media` });
    expect(featured.json().items).toHaveLength(0);

    // Restore consent within the window → only consent-revoked rows return; pending deletions cancelled.
    const restore = await instance.inject({ method: 'PATCH', url: `/api/registrations/${registrationId}`, headers: auth, payload: { media_consent: true } });
    expect(restore.statusCode).toBe(200);
    const afterRestore = await instance.inject({ method: 'GET', url: `/api/media/${mediaId}` });
    expect(afterRestore.statusCode).toBe(200);
    const pendingAfterRestore = await pool.query('SELECT id FROM pending_s3_deletions WHERE media_id = $1 AND processed_at IS NULL', [mediaId]);
    expect(pendingAfterRestore.rows).toHaveLength(0);
    await instance.close();
  });

  it('soft-deletes with organizer reason and recovers within the window, preserving created_at', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, caption: 'Recoverable' });
    const media = commit.json();

    const deleted = await instance.inject({ method: 'DELETE', url: `/api/media/${media.id}`, headers: auth });
    expect(deleted.statusCode).toBe(204);
    const publicRead = await instance.inject({ method: 'GET', url: `/api/media/${media.id}` });
    expect(publicRead.statusCode).toBe(404);
    expect(publicRead.json().error.code).toBe('MEDIA_HIDDEN');

    // Recently-deleted organizer view groups by owning series/event.
    const recentlyDeleted = await instance.inject({ method: 'GET', url: '/api/me/media/recently-deleted', headers: auth });
    expect(recentlyDeleted.statusCode).toBe(200);
    const groups = recentlyDeleted.json().items;
    const group = groups.find((g: { event_id: string | null }) => g.event_id === eventId);
    expect(group).toBeDefined();
    expect(group.items.some((item: { id: string }) => item.id === media.id)).toBe(true);

    const recovered = await instance.inject({ method: 'POST', url: `/api/media/${media.id}/recover`, headers: auth });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().created_at).toBe(media.created_at);
    const publicAfterRecover = await instance.inject({ method: 'GET', url: `/api/media/${media.id}` });
    expect(publicAfterRecover.statusCode).toBe(200);
    await instance.close();
  });

  it('returns 410 MEDIA_RECOVERY_EXPIRED once the recovery window has elapsed', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, caption: 'Expired' });
    const mediaId = commit.json().id;
    await instance.inject({ method: 'DELETE', url: `/api/media/${mediaId}`, headers: auth });
    await pool.query(`UPDATE media SET recovery_deadline = now() - interval '1 day' WHERE id = $1`, [mediaId]);
    const recover = await instance.inject({ method: 'POST', url: `/api/media/${mediaId}/recover`, headers: auth });
    expect(recover.statusCode).toBe(410);
    expect(recover.json().error.code).toBe('MEDIA_RECOVERY_EXPIRED');
    await instance.close();
  });

  it('PATCH edits caption and re-attribution with fresh snapshots; consent-revoked targets rejected', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, caption: 'Before' });
    const mediaId = commit.json().id;

    const edit = await instance.inject({ method: 'PATCH', url: `/api/media/${mediaId}`, headers: auth, payload: { caption: '{performer_name} at {event_name}', registration_id: registrationId } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().caption).toBe('{performer_name} at {event_name}');
    expect(edit.json().attribution.performer_name).toBe('Amy Hart');
    expect(edit.json().alt_text).toBe('Amy Hart at Media Night');

    const cleared = await instance.inject({ method: 'PATCH', url: `/api/media/${mediaId}`, headers: auth, payload: { registration_id: null } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().registration_id).toBeNull();
    expect(cleared.json().attribution).toBeNull();

    // Re-attribution to a registration whose consent is revoked → 409.
    await pool.query('UPDATE registrations SET media_consent = false WHERE id = $1', [registrationId]);
    const rejected = await instance.inject({ method: 'PATCH', url: `/api/media/${mediaId}`, headers: auth, payload: { registration_id: registrationId } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('MEDIA_CONSENT_REVOKED');
    await pool.query('UPDATE registrations SET media_consent = true WHERE id = $1', [registrationId]);
    await instance.close();
  });

  it('Featured pins: owner replaces the ordered list atomically; invalid pins rejected', async () => {
    const instance = app();
    const photoA = (await uploadPhoto(instance, { event_id: eventId })).json();
    const photoB = (await uploadPhoto(instance, { open_mic_id: openMicId })).json();
    const video = (await instance.inject({
      method: 'POST', url: '/api/media', headers: auth,
      payload: { media_type: 'video', video_url: 'https://vimeo.com/111111111', open_mic_id: openMicId },
    })).json();

    const put = await instance.inject({
      method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: auth,
      payload: { media_ids: [photoB.id, video.id, photoA.id] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().items.map((item: { id: string }) => item.id)).toEqual([photoB.id, video.id, photoA.id]);

    const publicFeatured = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}/featured-media` });
    expect(publicFeatured.json().items.map((item: { id: string }) => item.id)).toEqual([photoB.id, video.id, photoA.id]);

    // Unknown media id → MEDIA_FEATURED_INVALID.
    const unknown = await instance.inject({
      method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: auth,
      payload: { media_ids: ['c0000000-0000-4000-8000-000000000099'] },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('MEDIA_FEATURED_INVALID');

    // Duplicates rejected.
    const duplicates = await instance.inject({
      method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: auth,
      payload: { media_ids: [photoA.id, photoA.id] },
    });
    expect(duplicates.statusCode).toBe(400);

    // Media from another series is out of scope.
    const otherSeries = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, venue_name, address_line1, city, country, time_zone, activities, age_policy, registration_mode, status)
       VALUES ($1, 'Other Series', 'Venue', '1 Street', 'Dublin', 'IE', 'Europe/Dublin', ARRAY['singing'], 'both', 'both', 'active') RETURNING id`,
      [organizerProfileId],
    );
    const foreignPhoto = (await uploadPhoto(instance, { open_mic_id: otherSeries.rows[0].id })).json();
    const outOfScope = await instance.inject({
      method: 'PUT', url: `/api/open-mics/${openMicId}/featured-media`, headers: auth,
      payload: { media_ids: [foreignPhoto.id] },
    });
    expect(outOfScope.statusCode).toBe(400);
    expect(outOfScope.json().error.code).toBe('MEDIA_FEATURED_INVALID');
    await instance.close();
  });

  it('listings: type filter, shuffle stability under one seed, anchor window with both cursors', async () => {
    // Fresh scope: a second event with its own media set.
    const secondEvent = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, capacity)
       VALUES ($1, 'Pagination Night', now() + interval '21 days', now() + interval '21 days 3 hours', 'published', 'Europe/Dublin', 'Media Venue', '1 Test Street', 'Dublin', 'IE', 40)
       RETURNING id`,
      [openMicId],
    );
    const secondEventId = secondEvent.rows[0].id;
    const instance = app();
    const ids: string[] = [];
    for (let index = 0; index < 8; index++) {
      const commit = await uploadPhoto(instance, { event_id: secondEventId, caption: `Photo ${index}` });
      expect(commit.statusCode).toBe(201);
      ids.push(commit.json().id);
      await pool.query('UPDATE media SET created_at = created_at + $1 * interval \'1 minute\' WHERE id = $2', [index, ids[index]]);
    }
    await instance.inject({
      method: 'POST', url: '/api/media', headers: auth,
      payload: { media_type: 'video', video_url: 'https://vimeo.com/222222222', event_id: secondEventId },
    });

    // Type filter
    const photos = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo` });
    expect(photos.json().items).toHaveLength(8);
    const videos = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=video` });
    expect(videos.json().items).toHaveLength(1);

    // Newest first
    const newest = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&limit=3` });
    const firstPageIds = newest.json().items.map((item: { id: string }) => item.id);
    expect(firstPageIds).toEqual([ids[7], ids[6], ids[5]]);
    expect(newest.json().next_cursor).not.toBeNull();
    expect(newest.json().prev_cursor).toBeNull();

    // Page 2 via cursor
    const page2 = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&limit=3&cursor=${encodeURIComponent(newest.json().next_cursor)}` });
    expect(page2.json().items.map((item: { id: string }) => item.id)).toEqual([ids[4], ids[3], ids[2]]);
    expect(page2.json().prev_cursor).not.toBeNull();

    // Anchor window around the middle item: both cursors present, anchor included.
    const anchor = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&limit=5&anchor=${ids[3]}` });
    const anchorIds = anchor.json().items.map((item: { id: string }) => item.id);
    expect(anchorIds).toContain(ids[3]);
    expect(anchorIds).toEqual([ids[5], ids[4], ids[3], ids[2], ids[1]]);
    expect(anchor.json().prev_cursor).not.toBeNull();
    expect(anchor.json().next_cursor).not.toBeNull();

    // Anchor for an out-of-scope media id resolves to an empty page (client falls back).
    const outOfScope = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?anchor=${ids[0].replace(/.$/, '0')}` });
    expect([200]).toContain(outOfScope.statusCode);

    // Shuffle: same seed → same order; different seed → (almost surely) different order.
    const shuffleA1 = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&sort=shuffle&seed=42` });
    const shuffleA2 = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&sort=shuffle&seed=42` });
    expect(shuffleA1.json().items.map((item: { id: string }) => item.id)).toEqual(shuffleA2.json().items.map((item: { id: string }) => item.id));
    const shuffleB = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&sort=shuffle&seed=1337` });
    expect(shuffleB.json().items.map((item: { id: string }) => item.id)).not.toEqual(shuffleA1.json().items.map((item: { id: string }) => item.id));

    // most_liked is accepted and currently aliases newest.
    const liked = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&sort=most_liked&limit=3` });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().items[0].id).toBe(ids[7]);

    // A cursor minted under one sort/seed is rejected under another.
    const mismatched = await instance.inject({ method: 'GET', url: `/api/events/${secondEventId}/media?type=photo&sort=shuffle&seed=7&cursor=${encodeURIComponent(newest.json().next_cursor)}` });
    expect(mismatched.statusCode).toBe(400);
    await instance.close();
  });

  it('series gallery unions free-standing series media and published-event media', async () => {
    const instance = app();
    const list = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}/media` });
    const types = new Set(list.json().items.map((item: { media_type: string }) => item.media_type));
    expect(types.has('photo')).toBe(true);
    expect(types.has('video')).toBe(true);
    // Draft-event staged media never leaks into the public series gallery.
    const draftEvent = await pool.query<{ id: string }>(`SELECT id FROM events WHERE title = 'Draft Night'`);
    expect(list.json().items.some((item: { event_id: string | null }) => item.event_id === draftEvent.rows[0].id)).toBe(false);
    await instance.close();
  });

  it('profile gallery honors show_gig_media and adoption-based derivation', async () => {
    // Adopted performer profile for the registration.
    const performerAccount = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('media-performer', 'media-performer@example.test') RETURNING id",
    );
    const performer = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Amy Hart', 'performer') RETURNING id",
      [performerAccount.rows[0].id],
    );
    const performerProfileId = performer.rows[0].id;
    await pool.query('UPDATE registrations SET claimed_by_account_id = $1, claimed_at = now(), adopted_profile_id = $2 WHERE id = $3', [performerAccount.rows[0].id, performerProfileId, registrationId]);

    const instance = app();
    const gallery = await instance.inject({ method: 'GET', url: `/api/profiles/${performerProfileId}/media` });
    expect(gallery.statusCode).toBe(200);
    expect(gallery.json().items.length).toBeGreaterThan(0);
    // Attribution display switches to the adopted profile (design §4.2).
    expect(gallery.json().items[0].attribution.profile_id).toBe(performerProfileId);

    // Owner toggle off → empty page; event/series galleries unaffected.
    await pool.query('UPDATE profiles SET show_gig_media = false WHERE id = $1', [performerProfileId]);
    const hidden = await instance.inject({ method: 'GET', url: `/api/profiles/${performerProfileId}/media` });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().items).toHaveLength(0);
    const eventList = await instance.inject({ method: 'GET', url: `/api/events/${eventId}/media` });
    expect(eventList.json().items.length).toBeGreaterThan(0);
    await pool.query('UPDATE profiles SET show_gig_media = true WHERE id = $1', [performerProfileId]);
    await instance.close();
  });

  it('renditions callback stamps rendition metadata only with a valid signature', async () => {
    const { createHmac } = await import('node:crypto');
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, caption: 'Renditions' });
    const mediaId = commit.json().id;

    const payload = JSON.stringify({
      width: 1200,
      height: 800,
      renditions: {
        thumb: { url: `https://media.test/renditions/${mediaId}/thumb.webp`, width: 400, height: 267, mime_type: 'image/webp', size_bytes: 12000 },
        grid: { url: `https://media.test/renditions/${mediaId}/grid.webp`, width: 800, height: 533, mime_type: 'image/webp', size_bytes: 45000 },
        lightbox: { url: `https://media.test/renditions/${mediaId}/lightbox.webp`, width: 1200, height: 800, mime_type: 'image/webp', size_bytes: 140000 },
      },
    });
    // Default dev/test callback secret (config.ts default) signs the payload.
    const signature = createHmac('sha256', 'dev-insecure-media-renditions-callback-secret-change-me').update(payload, 'utf8').digest('hex');
    const response = await instance.inject({
      method: 'POST',
      url: `/api/internal/media/${mediaId}/renditions-complete`,
      headers: { 'content-type': 'text/plain', 'x-media-renditions-signature': `sha256=${signature}` },
      payload,
    });
    expect(response.statusCode).toBe(200);
    const read = await instance.inject({ method: 'GET', url: `/api/media/${mediaId}` });
    expect(read.json().width).toBe(1200);
    expect(read.json().renditions.grid.url).toContain('grid.webp');

    const badSignature = await instance.inject({
      method: 'POST',
      url: `/api/internal/media/${mediaId}/renditions-complete`,
      headers: { 'content-type': 'text/plain', 'x-media-renditions-signature': 'sha256=0000' },
      payload,
    });
    expect(badSignature.statusCode).toBe(401);
    await instance.close();
  });

  it('stamps OG tags into /media/:id HTML and falls back to event OG when hidden', async () => {
    const instance = app();
    const commit = await uploadPhoto(instance, { event_id: eventId, registration_id: registrationId, caption: '{performer_name} shines at {event_name}' });
    const mediaId = commit.json().id;

    const visible = await instance.inject({ method: 'GET', url: `/media/${mediaId}` });
    expect(visible.statusCode).toBe(200);
    expect(visible.headers['content-type']).toContain('text/html');
    expect(visible.headers['cache-control']).toBe('public, s-maxage=3600, max-age=0');
    expect(visible.body).toContain('property="og:title" content="Amy Hart shines at Media Night"');
    expect(visible.body).toContain(`property="og:url" content="http://localhost:5173/media/${mediaId}"`);
    expect(visible.body).toContain('name="twitter:card" content="summary_large_image"');
    expect(visible.body).toContain('property="og:image"');

    // Soft-delete → fallback OG (event title, no media image), still 200 HTML.
    await instance.inject({ method: 'DELETE', url: `/api/media/${mediaId}`, headers: auth });
    const hidden = await instance.inject({ method: 'GET', url: `/media/${mediaId}` });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.body).toContain('property="og:title" content="Media Night"');
    expect(hidden.body).not.toContain('og:image');

    // Unknown ids → generic site OG, still 200 (scrapers never see a 404).
    const unknown = await instance.inject({ method: 'GET', url: '/media/c0000000-0000-0000-0000-000000000077' });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body).toContain('og:site_name');
    await instance.close();
  });

  it('enforces plan caps: one series per organizer profile, event capacity required and ≤ 50', async () => {
    const instance = app();
    const freshProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Capped Organizer', 'organizer') RETURNING id",
      [ownerAccountId],
    );
    const headers = { authorization: 'Bearer media-owner', 'x-current-profile': freshProfile.rows[0].id };
    const payload = { name: 'Capped Series', venue_name: 'Venue', address_line1: '1 St', city: 'Dublin', country: 'IE', time_zone: 'Europe/Dublin', activities: ['singing'] };

    const first = await instance.inject({ method: 'POST', url: '/api/open-mics', headers, payload });
    expect(first.statusCode).toBe(201);
    const second = await instance.inject({ method: 'POST', url: '/api/open-mics', headers, payload: { ...payload, name: 'Second Series' } });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(second.json().error.details).toEqual({ scope: 'series' });

    const eventPayload = { title: 'Capped Event', starts_at: '2027-01-15T19:00:00Z', ends_at: '2027-01-15T22:00:00Z', time_zone: 'Europe/Dublin' };
    const unlimited = await instance.inject({ method: 'POST', url: `/api/open-mics/${openMicId}/events`, headers: auth, payload: eventPayload });
    expect(unlimited.statusCode).toBe(403);
    expect(unlimited.json().error.details).toEqual({ scope: 'event_capacity' });
    const overCap = await instance.inject({ method: 'POST', url: `/api/open-mics/${openMicId}/events`, headers: auth, payload: { ...eventPayload, capacity: 51 } });
    expect(overCap.statusCode).toBe(403);
    const atCap = await instance.inject({ method: 'POST', url: `/api/open-mics/${openMicId}/events`, headers: auth, payload: { ...eventPayload, capacity: 50 } });
    expect(atCap.statusCode).toBe(201);
    await instance.close();
  });
});
