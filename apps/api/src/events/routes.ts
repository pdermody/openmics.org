import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import type { AuthenticatedAccount } from '../auth/types.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { matchesCityName, matchesCountryName, requireActiveCityById } from '../cities/repository.js';
import { parseGeoFilter } from '../geo.js';
import { findOpenMicByIdOrPublicCode } from '../open-mics/repository.js';
import { assertEventCapacityAllowed, assertEventCountQuota, DEFAULT_PLAN } from '../media/plan.js';
import {
  findEventByIdOrPublicCode,
  findEventByIdOrPublicCodeIncludingDeleted,
  findEventsByOpenMicId,
  findPublicSeriesEvents,
  findNextEventByOpenMicId,
  findNextRegistrableEventByOpenMicId,
  findRunningEventByOpenMicId,
  findUpcomingEvents,
  findDiscoveryEvents,
  insertEvent,
  restoreEvent,
  serializeEvent,
  softDeleteEvent,
  updateEvent,
} from './repository.js';
import { notifyRoster, rosterChannelName, signKioskRegistrationToken, signStreamToken, verifyKioskRegistrationToken, verifyStreamToken } from './roster-stream.js';
import { createEventSchema, discoveryEventsQuerySchema, publicEventsQuerySchema, updateEventSchema } from './validation.js';

export type EventsPluginOptions = { pool: Pool; streamTokenSecret: string };

export const eventsRoutes: FastifyPluginAsync<EventsPluginOptions> = async (app, { pool, streamTokenSecret }) => {
  app.post<{ Params: { id: string } }>(
    '/open-mics/:id/events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = createEventSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid event payload', parsed.error.flatten());
      const input = parsed.data;
      // Plan capacity cap (decisions.md → DEFAULT_PLAN): pure input check before any DB
      // work — the default plan rejects capacity above 50 and unlimited (omitted) capacity.
      assertEventCapacityAllowed(DEFAULT_PLAN, input.capacity);

      const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
      if (!openMic) throw new NotFoundError('Open mic not found');

      // Verify ownership: the requester must own the open mic
      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own this open mic');
      }
      if (input.status === 'published' && openMic.status !== 'active') {
        throw new ValidationError('A published event requires an active open mic', { field: 'status' });
      }

      const created = await withTransaction(pool, async (client) => {
        // Plan cap: lifetime count of non-soft-deleted events in the series (draft +
        // published + past all count).
        const eventCount = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM events WHERE open_mic_id = $1 AND deleted_at IS NULL',
          [openMic.id],
        );
        assertEventCountQuota(DEFAULT_PLAN, Number(eventCount.rows[0].count));
        const hasLocationOverride = input.venue_name !== undefined;
        let cityId = hasLocationOverride ? null : openMic.city_id;
        let city = hasLocationOverride ? input.city : openMic.city;
        let country = hasLocationOverride ? input.country : openMic.country;
        if (input.city_id) {
          const selected = await requireActiveCityById(pool, input.city_id, 'city_id');
          if ((input.city && !matchesCityName(selected, input.city))
            || (input.country && !matchesCountryName(selected, input.country))) {
            throw new ValidationError('city and country must match the selected city', { field: 'city_id' });
          }
          cityId = input.city_id;
          city = selected.city;
          country = selected.country;
        } else if (!hasLocationOverride && input.city_id === null) {
          cityId = null;
        } else if (!hasLocationOverride && input.city_id === undefined && cityId) {
          await requireActiveCityById(pool, cityId, 'city_id');
        }
        return insertEvent(client, {
          openMicId: openMic.id,
          title: input.title,
          startsAt: input.starts_at,
          endsAt: input.ends_at,
          timeZone: input.time_zone,
          status: input.status,
          registrationsClosedAt: input.registrations_closed_at,
          // Location snapshot: use provided overrides or inherit from parent open mic
          venueName: input.venue_name ?? openMic.venue_name,
          addressLine1: input.address_line1 ?? openMic.address_line1,
          addressLine2: input.address_line2 ?? openMic.address_line2,
          postcode: input.postcode ?? openMic.postcode,
          city,
          country,
          cityId,
          lat: input.lat ?? (openMic.lat ? Number(openMic.lat) : null),
          lng: input.lng ?? (openMic.lng ? Number(openMic.lng) : null),
          activities: input.activities,
          tags: input.tags,
          capacity: input.capacity,
          notes: input.notes,
          entryFeeAmount: input.entry_fee_amount,
          entryFeeCurrency: input.entry_fee_currency,
          entryFeeNote: input.entry_fee_note,
        });
      });

      reply.status(201).send(serializeEvent(created));
    },
  );

  app.get<{ Params: { id: string } }>('/open-mics/:id/events', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic) throw new NotFoundError('Open mic not found');
    const isPublic = openMic.status === 'active';
    const canManage = await isOpenMicOwnerOrAdmin(pool, openMic.owner_profile_id, request.account);
    if (!isPublic && !canManage) {
      throw new NotFoundError('Open mic not found');
    }

    const events = await findEventsByOpenMicId(pool, openMic.id);
    reply.send((canManage ? events : events.filter((event) => event.status === 'published')).map((row) => serializeEvent(row)));
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id/public-events', async (request, reply) => {
    const parsed = publicEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid public events query', parsed.error.flatten());
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic || openMic.status !== 'active') throw new NotFoundError('Open mic not found');
    const now = new Date();
    const result = await findPublicSeriesEvents(pool, openMic.id, parsed.data, now);
    reply.send({
      items: result.rows.map((row) => serializeEvent(row, now)),
      pagination: { page: parsed.data.page, page_size: parsed.data.page_size, total: result.total },
      available_years: result.availableYears,
    });
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id/next-event', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic) throw new NotFoundError('Open mic not found');
    const isPublic = openMic.status === 'active';
    const canManage = await isOpenMicOwnerOrAdmin(pool, openMic.owner_profile_id, request.account);
    if (!isPublic && !canManage) {
      throw new NotFoundError('Open mic not found');
    }
    const [currentEvent, nextEvent, nextRegistrableEvent] = await Promise.all([
      findRunningEventByOpenMicId(pool, openMic.id),
      findNextEventByOpenMicId(pool, openMic.id),
      ['pre_only', 'both'].includes(openMic.registration_mode) ? findNextRegistrableEventByOpenMicId(pool, openMic.id) : null,
    ]);
    reply.send({
      current_event: currentEvent ? serializeEvent(currentEvent) : null,
      current_registration_open: Boolean(
        currentEvent
        && ['pre_only', 'both'].includes(openMic.registration_mode)
        && (!currentEvent.registrations_closed_at || new Date(currentEvent.registrations_closed_at) > new Date()),
      ),
      next_event: nextEvent ? serializeEvent(nextEvent) : null,
      next_registration_event: nextRegistrableEvent ? serializeEvent(nextRegistrableEvent) : null,
    });
  });

  app.get<{ Querystring: { near?: string; radius_km?: string; limit?: string; from?: string; to?: string } }>(
    '/events/upcoming',
    async (request, reply) => {
      const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 25)));
      const geo = parseGeoFilter(request.query.near, request.query.radius_km);
      const events = await findUpcomingEvents(pool, {
        from: request.query.from,
        to: request.query.to,
        limit,
        geo,
      });
      reply.send(events.map((row) => serializeEvent(row)));
    },
  );

  app.get<{ Querystring: { near?: string; radius_km?: string; page?: string; page_size?: string } }>(
    '/events/discovery',
    async (request) => {
      const parsed = discoveryEventsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new ValidationError('Invalid event discovery query', parsed.error.flatten());
      if (!parsed.data.near && request.query.radius_km !== undefined) {
        throw new ValidationError('radius_km requires near', { field: 'radius_km' });
      }
      let geo: { lat: number; lng: number; radiusKm: number } | undefined;
      if (parsed.data.near) {
        const [latText, lngText] = parsed.data.near.split(',');
        const lat = Number(latText);
        const lng = Number(lngText);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          throw new ValidationError('near must contain valid latitude and longitude');
        }
        geo = { lat, lng, radiusKm: parsed.data.radius_km };
      }
      const result = await findDiscoveryEvents(pool, {
        page: parsed.data.page,
        pageSize: parsed.data.page_size,
        geo,
      });
      return {
        items: result.rows.map((row) => serializeEvent(row)),
        pagination: { page: parsed.data.page, page_size: parsed.data.page_size, total: result.total },
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { kiosk_token?: string } }>('/events/:id', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const event = await findEventByIdOrPublicCode(pool, request.params.id);
    if (!event) throw new NotFoundError('Event not found');
    const openMic = await findOpenMicByIdOrPublicCode(pool, event.open_mic_id);
    const canManage = openMic && await isOpenMicOwnerOrAdmin(pool, openMic.owner_profile_id, request.account);
    const hasKioskAccess = request.query.kiosk_token
      ? await verifyKioskRegistrationToken(streamTokenSecret, request.query.kiosk_token).then((claims) => claims.eventId === event.id, () => false)
      : false;
    if (!openMic || (!canManage && !hasKioskAccess && (openMic.status !== 'active' || event.status !== 'published'))) {
      throw new NotFoundError('Event not found');
    }
    reply.send(serializeEvent(event));
  });

  app.get<{ Params: { id: string; eventId: string } }>('/open-mics/:id/events/:eventId', { preHandler: app.authenticateOptional }, async (request, reply) => {
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic) throw new NotFoundError('Event not found');
    const event = await findEventByIdOrPublicCode(pool, request.params.eventId);
    const canManage = await isOpenMicOwnerOrAdmin(pool, openMic.owner_profile_id, request.account);
    if (!event || event.open_mic_id !== openMic.id || (!canManage && (openMic.status !== 'active' || event.status !== 'published'))) throw new NotFoundError('Event not found');
    reply.send(serializeEvent(event));
  });

  app.patch<{ Params: { id: string } }>(
    '/events/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = updateEventSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid event payload', parsed.error.flatten());
      // Plan capacity cap on edits (decisions.md → DEFAULT_PLAN): rejected only when the
      // request changes capacity; unrelated edits never restate it.
      if (parsed.data.capacity !== undefined) assertEventCapacityAllowed(DEFAULT_PLAN, parsed.data.capacity);

      const existing = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!existing) throw new NotFoundError('Event not found');

      const openMic = await findOpenMicByIdOrPublicCode(pool, existing.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own the parent open mic');
      }
      if (parsed.data.status === 'published' && openMic.status !== 'active') {
        throw new ValidationError('A published event requires an active open mic', { field: 'status' });
      }

      const changes: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) changes.title = parsed.data.title;
      if (parsed.data.starts_at !== undefined) changes.startsAt = parsed.data.starts_at;
      if (parsed.data.ends_at !== undefined) changes.endsAt = parsed.data.ends_at;
      if (parsed.data.time_zone !== undefined) changes.timeZone = parsed.data.time_zone;
      if (parsed.data.status !== undefined) changes.status = parsed.data.status;
      if (parsed.data.registrations_closed_at !== undefined)
        changes.registrationsClosedAt = parsed.data.registrations_closed_at;
      if (parsed.data.venue_name !== undefined) changes.venueName = parsed.data.venue_name;
      if (parsed.data.address_line1 !== undefined) changes.addressLine1 = parsed.data.address_line1;
      if (parsed.data.address_line2 !== undefined) changes.addressLine2 = parsed.data.address_line2;
      if (parsed.data.postcode !== undefined) changes.postcode = parsed.data.postcode;
      if (parsed.data.city !== undefined) changes.city = parsed.data.city;
      if (parsed.data.country !== undefined) changes.country = parsed.data.country;
      if (parsed.data.lat !== undefined) changes.lat = parsed.data.lat;
      if (parsed.data.lng !== undefined) changes.lng = parsed.data.lng;
      if (parsed.data.activities !== undefined) changes.activities = parsed.data.activities;
      if (parsed.data.tags !== undefined) changes.tags = parsed.data.tags;
      if (parsed.data.capacity !== undefined) changes.capacity = parsed.data.capacity;
      if (parsed.data.notes !== undefined) changes.notes = parsed.data.notes;
      if (parsed.data.entry_fee_amount !== undefined) changes.entryFeeAmount = parsed.data.entry_fee_amount;
      if (parsed.data.entry_fee_currency !== undefined) changes.entryFeeCurrency = parsed.data.entry_fee_currency;
      if (parsed.data.entry_fee_note !== undefined) changes.entryFeeNote = parsed.data.entry_fee_note;
      const lifecycleOnly = Object.keys(parsed.data).every((field) => field === 'status' || field === 'registrations_closed_at');
      if (parsed.data.city_id) {
        const selected = await requireActiveCityById(pool, parsed.data.city_id, 'city_id');
        if ((parsed.data.city && !matchesCityName(selected, parsed.data.city))
          || (parsed.data.country && !matchesCountryName(selected, parsed.data.country))) {
          throw new ValidationError('city and country must match the selected city', { field: 'city_id' });
        }
        changes.city = selected.city;
        changes.country = selected.country;
        changes.cityId = parsed.data.city_id;
      } else if (parsed.data.city_id === null || parsed.data.city !== undefined || parsed.data.country !== undefined) {
        changes.cityId = null;
      } else if (!lifecycleOnly && existing.city_id) {
        await requireActiveCityById(pool, existing.city_id, 'city_id');
      }

      const effectiveStartsAt = parsed.data.starts_at ?? existing.starts_at;
      const effectiveEndsAt = parsed.data.ends_at ?? existing.ends_at;
      const effectiveStatus = parsed.data.status ?? existing.status;
      if (effectiveStatus === 'published' && (!effectiveEndsAt || new Date(effectiveEndsAt) <= new Date(effectiveStartsAt))) {
        throw new ValidationError('A published event requires an end time after its start time', { field: 'ends_at' });
      }
      const updated = await updateEvent(pool, existing.id, changes as Parameters<typeof updateEvent>[2]);
      if (!updated) throw new NotFoundError('Event not found after update');

      reply.send(serializeEvent(updated));
      void notifyRoster(pool, existing.id, 'event.updated', { event_id: existing.id }).catch((error) =>
        app.log.error({ error }, 'Failed to publish roster notification'),
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/events/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const existing = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!existing) throw new NotFoundError('Event not found');

      const openMic = await findOpenMicByIdOrPublicCode(pool, existing.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own the parent open mic');
      }

      const deleted = await softDeleteEvent(pool, existing.id, openMic.owner_profile_id);
      if (!deleted) throw new NotFoundError('Event not found');
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/recover',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const existing = await findEventByIdOrPublicCodeIncludingDeleted(pool, request.params.id);
      if (!existing) throw new NotFoundError('Event not found');

      const openMic = await findOpenMicByIdOrPublicCode(pool, existing.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own the parent open mic');
      }

      const restored = await restoreEvent(pool, existing.id);
      if (!restored) throw new NotFoundError('Event not found, already active, or past its 30-day recovery window');
      reply.send(serializeEvent(restored));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/kiosk-registration-token',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const event = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!event) throw new NotFoundError('Event not found');
      const openMic = await findOpenMicByIdOrPublicCode(pool, event.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerAccountId = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerAccountId !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('Only the event organizer can issue kiosk registration tokens');
      }

      const { token, expiresAt } = await signKioskRegistrationToken(streamTokenSecret, event);
      reply.send({ kiosk_token: token, expires_at: expiresAt.toISOString() });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/roster/stream-token',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const event = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!event) throw new NotFoundError('Event not found');

      const openMic = await findOpenMicByIdOrPublicCode(pool, event.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('Only the event organizer can open the roster stream');
      }

      const { token, expiresAt } = await signStreamToken(streamTokenSecret, event.id);
      reply.send({ stream_token: token, expires_at: expiresAt.toISOString() });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { stream_token?: string } }>(
    '/events/:id/roster/stream',
    async (request, reply) => {
      const event = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!event) throw new NotFoundError('Event not found');

      if (!request.query.stream_token) throw new ForbiddenError('A stream_token is required');
      let claims;
      try {
        claims = await verifyStreamToken(streamTokenSecret, request.query.stream_token);
      } catch {
        throw new ForbiddenError('Invalid or expired stream token');
      }
      if (claims.eventId !== event.id) throw new ForbiddenError('Stream token is not valid for this event');

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let sequence = 0;
      function send(eventName: string, data: Record<string, unknown>) {
        sequence += 1;
        raw.write(`id: ${sequence}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      // No durable event log is kept (see decisions.md → Live updates), so a resumed connection
      // can never be satisfied incrementally: tell the client to refetch in full before it
      // resumes receiving live updates, rather than silently pretending to replay.
      if (request.headers['last-event-id']) send('resync_required', {});

      const client = await pool.connect();
      const channel = rosterChannelName(event.id);
      function onNotification(message: { channel: string; payload?: string }) {
        if (message.channel !== channel) return;
        const payload = message.payload ? JSON.parse(message.payload) : {};
        send(payload.event ?? 'roster.updated', payload);
      }
      client.on('notification', onNotification);
      await client.query(`LISTEN ${channel}`);

      const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000);

      function cleanup() {
        clearInterval(heartbeat);
        client.removeListener('notification', onNotification);
        client.query(`UNLISTEN ${channel}`).catch(() => {});
        client.release();
      }
      request.raw.on('close', cleanup);
    },
  );
};

async function findOpenMicOwnerAccountId(pool: Pool, ownerProfileId: string): Promise<string> {
  const result = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1',
    [ownerProfileId],
  );
  if (result.rows.length === 0) throw new NotFoundError('Owner profile not found');
  return result.rows[0].created_by_account_id;
}

// Draft/ended open mics are hidden from the public directory and its event listings, but the
// owning organizer (or a platform admin) must still be able to see their own draft/ended series'
// events from the dashboard. `request.account` is undefined for anonymous callers.
async function isOpenMicOwnerOrAdmin(
  pool: Pool,
  ownerProfileId: string,
  account: AuthenticatedAccount | undefined,
): Promise<boolean> {
  if (!account) return false;
  if (account.isPlatformAdmin) return true;
  const result = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1',
    [ownerProfileId],
  );
  return result.rows[0]?.created_by_account_id === account.accountId;
}
