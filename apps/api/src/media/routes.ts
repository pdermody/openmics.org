import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import type { AppConfig } from '../config.js';
import { withTransaction } from '../db.js';
import {
  ForbiddenError,
  MediaConsentRevokedError,
  MediaFeaturedInvalidError,
  MediaHiddenError,
  MediaNotFoundError,
  MediaRecoveryExpiredError,
  MediaSourcePolicyError,
  MediaUploadInvalidError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';
import { findEventByIdOrPublicCode, type EventRow } from '../events/repository.js';
import { findOpenMicById, findOpenMicByIdOrPublicCode, type OpenMicRow } from '../open-mics/repository.js';
import { findRegistrationById, type RegistrationRow } from '../registrations/repository.js';
import { enqueueMediaDeletions } from './objects.js';
import {
  assertAccountByteQuota,
  assertEventPhotoQuota,
  assertEventVideoQuota,
  assertMimeAllowed,
  assertSizeAllowed,
  planForConfig,
} from './plan.js';
import type { RenditionsQueueAdapter } from './renditions/queue-adapter.js';
import {
  cancelPendingDeletionsForMedia,
  countEventMediaByType,
  findMediaById,
  findMediaOwnerAccountId,
  findRecentlyDeletedMediaForAccount,
  insertMedia,
  insertPendingDeletion,
  isMediaPubliclyVisible,
  listEventMedia,
  listFeaturedMedia,
  listOpenMicMedia,
  listProfileMedia,
  recoverMedia,
  removeFeaturedPinsForMedia,
  replaceFeaturedMedia,
  softDeleteMedia,
  sumAccountMediaBytes,
  updateMediaMetadata,
  updateMediaRenditions,
  type MediaListQuery,
  type MediaListRow,
} from './repository.js';
import { serializeMedia } from './serialize.js';
import { canonicalVideoUrl, PHOTO_MIME_EXTENSIONS, validatePhotoSourceKey, validateVideoUrl, videoThumbnailUrl } from './source-policy.js';
import type { MediaStorageAdapter } from './storage/types.js';
import {
  createMediaSchema,
  featuredMediaSchema,
  mediaListQuerySchema,
  renditionsCompleteSchema,
  updateMediaSchema,
  uploadUrlRequestSchema,
  type CreateMediaInput,
  type MediaListQueryInput,
} from './validation.js';

export type MediaPluginOptions = {
  pool: Pool;
  config: AppConfig;
  storage: MediaStorageAdapter;
  renditionsQueue: RenditionsQueueAdapter;
};

async function ownerAccountOfProfile(client: Pool | PoolClient, profileId: string): Promise<string | null> {
  const result = await client.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1',
    [profileId],
  );
  return result.rows[0]?.created_by_account_id ?? null;
}

export const mediaRoutes: FastifyPluginAsync<MediaPluginOptions> = async (app, { pool, config, storage, renditionsQueue }) => {
  const plan = planForConfig(config);
  const mediaBucket = config.mediaBucket ?? 'local';

  function parseListQuery(raw: unknown): MediaListQueryInput {
    const parsed = mediaListQuerySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Invalid media list query', parsed.error.flatten());
    return parsed.data;
  }

  function sendListPage(reply: FastifyReply, page: { rows: MediaListRow[]; prevCursor: string | null; nextCursor: string | null }) {
    reply.send({ items: page.rows.map(serializeMedia), prev_cursor: page.prevCursor, next_cursor: page.nextCursor });
  }

  /** Caller must own the media's series (or be a platform admin). */
  async function requireMediaOwner(request: FastifyRequest, media: MediaListRow): Promise<void> {
    const account = request.account!;
    const ownerAccountId = await findMediaOwnerAccountId(pool, media);
    if (ownerAccountId !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this media');
    }
  }

  /** True when the caller owns the series (or is admin); anonymous callers get false. */
  async function canManageSeries(ownerProfileId: string, account: { accountId: string; isPlatformAdmin: boolean } | undefined): Promise<boolean> {
    if (!account) return false;
    if (account.isPlatformAdmin) return true;
    return (await ownerAccountOfProfile(pool, ownerProfileId)) === account.accountId;
  }

  // -------------------------------------------------------------------------
  // Upload reservation + commit
  // -------------------------------------------------------------------------

  app.post('/media/upload-url', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = uploadUrlRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid upload-url payload', parsed.error.flatten());
    if (parsed.data.media_type !== 'photo') {
      throw new MediaUploadInvalidError('Only photo uploads use the upload-url flow; videos are added as links.');
    }
    const { mime_type, size_bytes } = parsed.data;
    assertMimeAllowed(plan, mime_type);
    const declaredSize = size_bytes ?? 1;
    assertSizeAllowed(plan, declaredSize);
    // Account byte backstop is checked again at commit with the object's real size.
    assertAccountByteQuota(plan, await sumAccountMediaBytes(pool, request.account!.accountId), declaredSize);

    const upload = await storage.createPresignedUploadUrl({
      ownerAccountId: request.account!.accountId,
      mimeType: mime_type,
      sizeBytes: declaredSize,
      extension: PHOTO_MIME_EXTENSIONS[mime_type],
      expiresInSeconds: plan.presignExpirySeconds,
    });
    reply.send({ upload_url: upload.uploadUrl, object_key: upload.objectKey, expires_at: upload.expiresAt.toISOString() });
  });

  async function createMedia(
    request: FastifyRequest,
    input: CreateMediaInput,
    pathScope: { eventId?: string; openMicId?: string },
  ) {
    if (pathScope.eventId && input.event_id && input.event_id !== pathScope.eventId) {
      throw new ValidationError('event_id does not match the path', { field: 'event_id' });
    }
    if (pathScope.openMicId && input.open_mic_id && input.open_mic_id !== pathScope.openMicId) {
      throw new ValidationError('open_mic_id does not match the path', { field: 'open_mic_id' });
    }
    const account = request.account!;

    // Resolve the owning scope (path or body; exactly one).
    let event: EventRow | null = null;
    let openMic: OpenMicRow | null = null;
    if (pathScope.eventId || (!pathScope.openMicId && input.event_id)) {
      event = await findEventByIdOrPublicCode(pool, pathScope.eventId ?? input.event_id!);
      if (!event) throw new NotFoundError('Event not found');
      openMic = await findOpenMicById(pool, event.open_mic_id);
    } else if (pathScope.openMicId || input.open_mic_id) {
      openMic = await findOpenMicByIdOrPublicCode(pool, pathScope.openMicId ?? input.open_mic_id!);
      if (!openMic) throw new NotFoundError('Open mic not found');
    } else {
      throw new ValidationError('Exactly one of event_id or open_mic_id is required', { field: 'event_id' });
    }
    if (!openMic) throw new NotFoundError('Parent open mic not found');
    if (event && input.open_mic_id && input.open_mic_id !== openMic.id && input.open_mic_id !== openMic.public_code) {
      throw new ValidationError('open_mic_id does not match the event\'s series', { field: 'open_mic_id' });
    }
    if ((await ownerAccountOfProfile(pool, openMic.owner_profile_id)) !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this open mic');
    }

    // Performer attribution: event media only, consent-gated (retroactive — revocation
    // blocks NEW attribution too, decisions.md → Guest Registrations).
    let registration: RegistrationRow | null = null;
    if (input.registration_id) {
      if (!event) throw new ValidationError('registration_id is only valid for event media', { field: 'registration_id' });
      registration = await findRegistrationById(pool, input.registration_id);
      if (!registration || registration.event_id !== event.id) {
        throw new ValidationError('registration_id must reference a registration on this event', { field: 'registration_id' });
      }
      if (!registration.media_consent) throw new MediaConsentRevokedError();
    }

    // Per-event count caps are enforced at commit (decisions.md → DEFAULT_PLAN).
    if (event) {
      const count = await countEventMediaByType(pool, event.id, input.media_type);
      if (input.media_type === 'photo') assertEventPhotoQuota(plan, count);
      else assertEventVideoQuota(plan, count);
    }

    const snapshots = {
      performerNameSnapshot: registration?.performer_name ?? null,
      performerCitySnapshot: registration?.performer_city ?? null,
    };
    const scope = { eventId: event?.id ?? null, openMicId: event ? null : openMic.id };

    if (input.media_type === 'video') {
      const video = validateVideoUrl(input.video_url);
      const mediaId = randomUUID();
      await withTransaction(pool, (client) =>
        insertMedia(client, {
          id: mediaId,
          mediaType: 'video',
          ...scope,
          registrationId: registration?.id ?? null,
          addedByProfileId: openMic.owner_profile_id,
          sourceUrl: canonicalVideoUrl(video),
          mimeType: null,
          sizeBytes: null,
          videoPlatform: video.platform,
          platformVideoId: video.platformVideoId,
          thumbnailUrl: videoThumbnailUrl(video),
          caption: input.caption ?? null,
          ...snapshots,
        }),
      );
      return findMediaById(pool, mediaId);
    }

    // Photo commit: the object must be a pending upload owned by this account (never a
    // client-supplied URL), within plan MIME/size rules — validated against the actual
    // object, not the client's declaration.
    validatePhotoSourceKey(input.object_key, account.accountId);
    const pending = await storage.statPendingObject(input.object_key);
    if (!pending) {
      throw new MediaSourcePolicyError('The upload does not exist or has expired; request a new upload URL.');
    }
    assertMimeAllowed(plan, pending.contentType);
    assertSizeAllowed(plan, pending.sizeBytes);
    assertAccountByteQuota(plan, await sumAccountMediaBytes(pool, account.accountId), pending.sizeBytes);

    const mediaId = randomUUID();
    const committed = await storage.commitObject(input.object_key, mediaId);
    if (!committed) {
      throw new MediaSourcePolicyError('The upload does not exist or has expired; request a new upload URL.');
    }
    try {
      await withTransaction(pool, (client) =>
        insertMedia(client, {
          id: mediaId,
          mediaType: 'photo',
          ...scope,
          registrationId: registration?.id ?? null,
          addedByProfileId: openMic.owner_profile_id,
          sourceUrl: storage.publicUrl(committed.objectKey),
          mimeType: committed.contentType,
          sizeBytes: committed.sizeBytes,
          videoPlatform: null,
          platformVideoId: null,
          thumbnailUrl: null,
          caption: input.caption ?? null,
          ...snapshots,
        }),
      );
    } catch (error) {
      // The object was already moved off the 24h tmp prefix; queue its deletion rather
      // than leak it when the row write failed.
      await insertPendingDeletion(pool, {
        bucket: mediaBucket,
        objectKey: committed.objectKey,
        mediaId,
        reason: 'manual',
        scheduledFor: new Date(),
      }).catch((cleanupError) => request.log.error({ cleanupError }, 'Failed to enqueue orphan media cleanup'));
      throw error;
    }
    await renditionsQueue.enqueue({ mediaId, objectKey: committed.objectKey });
    return findMediaById(pool, mediaId);
  }

  app.post('/media', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createMediaSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid media payload', parsed.error.flatten());
    reply.status(201).send(serializeMedia((await createMedia(request, parsed.data, {}))!));
  });

  app.post<{ Params: { id: string } }>('/events/:id/media', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createMediaSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid media payload', parsed.error.flatten());
    reply.status(201).send(serializeMedia((await createMedia(request, parsed.data, { eventId: request.params.id }))!));
  });

  app.post<{ Params: { id: string } }>('/open-mics/:id/media', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createMediaSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid media payload', parsed.error.flatten());
    reply.status(201).send(serializeMedia((await createMedia(request, parsed.data, { openMicId: request.params.id }))!));
  });

  // -------------------------------------------------------------------------
  // Single-item read / update / lifecycle
  // -------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/media/:id', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const media = await findMediaById(pool, request.params.id);
    if (!media) throw new MediaNotFoundError();
    const ownerAccountId = await findMediaOwnerAccountId(pool, media);
    const canManage = Boolean(
      request.account && (request.account.isPlatformAdmin || ownerAccountId === request.account.accountId),
    );
    if (canManage) {
      reply.send(serializeMedia(media));
      return;
    }
    // Hidden reads carry the owning scope in details so the /media/:id deep-link page can
    // render the surrounding event/series page with its "not available anymore" toast
    // (design §12.1). ids are unguessable UUIDs; this leaks nothing an attacker can use.
    const hiddenDetails = { event_id: media.event_id, open_mic_id: media.series_id };
    if (media.deleted_at) throw new MediaHiddenError('Media is not available', hiddenDetails);
    if (!isMediaPubliclyVisible(media)) throw new MediaHiddenError('Media is not available', hiddenDetails);
    reply.send(serializeMedia(media));
  });

  app.patch<{ Params: { id: string } }>('/media/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updateMediaSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid media payload', parsed.error.flatten());
    const media = await findMediaById(pool, request.params.id);
    if (!media) throw new MediaNotFoundError();
    await requireMediaOwner(request, media);
    if (media.deleted_at) throw new MediaHiddenError('Recover the media before editing it');

    const changes: Parameters<typeof updateMediaMetadata>[2] = {};
    if (parsed.data.caption !== undefined) changes.caption = parsed.data.caption;
    if (parsed.data.registration_id !== undefined) {
      if (parsed.data.registration_id === null) {
        changes.registrationId = null;
        changes.performerNameSnapshot = null;
        changes.performerCitySnapshot = null;
      } else {
        if (!media.event_id) {
          throw new ValidationError('Series media cannot carry performer attribution', { field: 'registration_id' });
        }
        const registration = await findRegistrationById(pool, parsed.data.registration_id);
        if (!registration || registration.event_id !== media.event_id) {
          throw new ValidationError('registration_id must reference a registration on this event', { field: 'registration_id' });
        }
        if (!registration.media_consent) throw new MediaConsentRevokedError();
        changes.registrationId = registration.id;
        changes.performerNameSnapshot = registration.performer_name;
        changes.performerCitySnapshot = registration.performer_city;
      }
    }

    await updateMediaMetadata(pool, media.id, changes);
    reply.send(serializeMedia((await findMediaById(pool, media.id))!));
  });

  app.delete<{ Params: { id: string } }>('/media/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const media = await findMediaById(pool, request.params.id);
    if (!media || media.deleted_at) throw new MediaNotFoundError();
    await requireMediaOwner(request, media);

    await withTransaction(pool, async (client: PoolClient) => {
      const deleted = await softDeleteMedia(client, media.id, {
        deletedByProfileId: media.series_owner_profile_id,
        reason: 'organizer',
      });
      if (!deleted) throw new MediaNotFoundError();
      await enqueueMediaDeletions(client, deleted, { bucket: mediaBucket, cdnBaseUrl: config.mediaCdnBaseUrl, reason: 'purge' });
      await removeFeaturedPinsForMedia(client, [media.id]);
    });
    reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/media/:id/recover', { preHandler: app.authenticate }, async (request, reply) => {
    const media = await findMediaById(pool, request.params.id);
    if (!media || !media.deleted_at) throw new MediaNotFoundError('Media not found');
    await requireMediaOwner(request, media);
    if (media.deletion_reason === 'consent_revocation') {
      throw new MediaConsentRevokedError("Media hidden by a consent revocation is restored by restoring the registration's consent.");
    }
    if (!media.recovery_deadline || media.recovery_deadline.getTime() <= Date.now()) {
      throw new MediaRecoveryExpiredError();
    }
    await withTransaction(pool, async (client: PoolClient) => {
      await recoverMedia(client, media.id);
      await cancelPendingDeletionsForMedia(client, media.id);
    });
    reply.send(serializeMedia((await findMediaById(pool, media.id))!));
  });

  // -------------------------------------------------------------------------
  // Gallery listings
  // -------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/events/:id/media', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const query = parseListQuery(request.query);
    const event = await findEventByIdOrPublicCode(pool, request.params.id);
    if (!event) throw new NotFoundError('Event not found');
    const openMic = await findOpenMicById(pool, event.open_mic_id);
    if (!openMic || openMic.deleted_at) throw new NotFoundError('Event not found');
    const canManage = await canManageSeries(openMic.owner_profile_id, request.account);
    const isPublic = openMic.status !== 'draft' && openMic.status !== 'ended' && event.status === 'published';
    if (!canManage && !isPublic) throw new NotFoundError('Event not found');
    sendListPage(reply, await listEventMedia(pool, event.id, { ...query, includePubliclyHidden: canManage }));
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id/media', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const query = parseListQuery(request.query);
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic || openMic.deleted_at) throw new NotFoundError('Open mic not found');
    const canManage = await canManageSeries(openMic.owner_profile_id, request.account);
    sendListPage(reply, await listOpenMicMedia(pool, openMic.id, {
      ...query,
      includePubliclyHidden: canManage,
      excludeFeaturedForOpenMicId: query.exclude_featured === 'true' ? openMic.id : undefined,
    }));
  });

  app.get<{ Params: { id: string } }>('/profiles/:id/media', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const query = parseListQuery(request.query);
    const profile = await pool.query<{ id: string; show_gig_media: boolean }>(
      `SELECT id, show_gig_media FROM profiles
       WHERE id = $1 AND deleted_at IS NULL AND visibility <> 'private' AND is_hidden = false AND is_blacklisted = false`,
      [request.params.id],
    );
    const row = profile.rows[0];
    if (!row) throw new NotFoundError('Profile not found');
    // The owner toggle empties the profile gallery only; event/series galleries are unaffected.
    if (!row.show_gig_media) {
      reply.send({ items: [], prev_cursor: null, next_cursor: null });
      return;
    }
    // Derived galleries are a public view: no owner override (the public page is what the
    // owner preview matches); soft-deleted rows stay exclusive to recently-deleted.
    sendListPage(reply, await listProfileMedia(pool, row.id, { ...query, includePubliclyHidden: false }));
  });

  // -------------------------------------------------------------------------
  // Recently deleted (organizer manage view)
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/me/media/recently-deleted',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 24) || 24));
      const { rows, nextCursor } = await findRecentlyDeletedMediaForAccount(pool, request.account!.accountId, {
        cursor: request.query.cursor,
        limit,
      });
      const groups = new Map<string, { open_mic_id: string; open_mic_name: string; event_id: string | null; event_title: string | null; items: MediaListRow[] }>();
      for (const row of rows) {
        const key = `${row.owner_open_mic_id}:${row.event_id ?? ''}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            open_mic_id: row.owner_open_mic_id,
            open_mic_name: row.owner_open_mic_name,
            event_id: row.event_id,
            event_title: row.event_name,
            items: [],
          };
          groups.set(key, group);
        }
        group.items.push(row);
      }
      reply.send({
        items: [...groups.values()].map((group) => ({
          open_mic_id: group.open_mic_id,
          open_mic_name: group.open_mic_name,
          event_id: group.event_id,
          event_title: group.event_title,
          items: group.items.map(serializeMedia),
        })),
        next_cursor: nextCursor,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Featured pins (series page strip)
  // -------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/open-mics/:id/featured-media', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic || openMic.deleted_at) throw new NotFoundError('Open mic not found');
    const canManage = await canManageSeries(openMic.owner_profile_id, request.account);
    const rows = await listFeaturedMedia(pool, openMic.id, canManage);
    reply.send({ items: rows.map(serializeMedia) });
  });

  app.put<{ Params: { id: string } }>('/open-mics/:id/featured-media', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = featuredMediaSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid featured media payload', parsed.error.flatten());
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic || openMic.deleted_at) throw new NotFoundError('Open mic not found');
    if (!(await canManageSeries(openMic.owner_profile_id, request.account))) {
      throw new ForbiddenError('You do not own this open mic');
    }

    const mediaIds = parsed.data.media_ids;
    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new MediaFeaturedInvalidError('Featured media cannot contain duplicates');
    }
    for (const mediaId of mediaIds) {
      const media = await findMediaById(pool, mediaId);
      if (!media || media.deleted_at) throw new MediaFeaturedInvalidError();
      if (media.series_id !== openMic.id) {
        throw new MediaFeaturedInvalidError('Featured media must belong to this series or one of its events');
      }
      if (!isMediaPubliclyVisible(media)) throw new MediaFeaturedInvalidError();
    }

    await withTransaction(pool, (client) => replaceFeaturedMedia(client, openMic.id, mediaIds));
    const rows = await listFeaturedMedia(pool, openMic.id, true);
    reply.send({ items: rows.map(serializeMedia) });
  });

  // -------------------------------------------------------------------------
  // Rendition pipeline callback (internal; HMAC-signed with the shared secret)
  // -------------------------------------------------------------------------

  // The Lambda signs the exact body bytes; sending text/plain makes Fastify hand us the
  // raw string so the HMAC covers precisely what was sent (no JSON re-serialization drift).
  app.post<{ Params: { id: string } }>('/internal/media/:id/renditions-complete', async (request, reply) => {
    const signature = request.headers['x-media-renditions-signature'];
    const rawBody = typeof request.body === 'string' ? request.body : null;
    if (!rawBody || typeof signature !== 'string' || !signature.startsWith('sha256=')) {
      throw new UnauthorizedError('A signed renditions callback is required');
    }
    const expected = createHmac('sha256', config.mediaRenditionsCallbackSecret ?? '').update(rawBody, 'utf8').digest();
    const provided = Buffer.from(signature.slice('sha256='.length), 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedError('Invalid renditions callback signature');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ValidationError('Renditions callback body must be JSON');
    }
    const parsed = renditionsCompleteSchema.safeParse(payload);
    if (!parsed.success) throw new ValidationError('Invalid renditions payload', parsed.error.flatten());

    const media = await findMediaById(pool, request.params.id);
    // Ack-and-drop when the row is gone or deleted: retrying can never succeed, and the
    // message should not burn SQS retries into the DLQ for a permanently-failed target.
    if (!media || media.deleted_at) {
      reply.send({ ok: true });
      return;
    }
    await updateMediaRenditions(pool, media.id, parsed.data.renditions, {
      width: parsed.data.width,
      height: parsed.data.height,
    });
    reply.send({ ok: true });
  });
};
