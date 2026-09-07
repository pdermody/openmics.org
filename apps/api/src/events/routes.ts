import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { parseGeoFilter } from '../geo.js';
import { findOpenMicById } from '../open-mics/repository.js';
import {
  findEventById,
  findEventByIdOrPublicCode,
  findEventsByOpenMicId,
  findNextEventByOpenMicId,
  findUpcomingEvents,
  insertEvent,
  serializeEvent,
  updateEvent,
} from './repository.js';
import { createEventSchema, updateEventSchema } from './validation.js';

export type EventsPluginOptions = { pool: Pool };

export const eventsRoutes: FastifyPluginAsync<EventsPluginOptions> = async (app, { pool }) => {
  app.post<{ Params: { id: string } }>(
    '/open-mics/:id/events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = createEventSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid event payload', parsed.error.flatten());
      const input = parsed.data;

      const openMic = await findOpenMicById(pool, request.params.id);
      if (!openMic) throw new NotFoundError('Open mic not found');

      // Verify ownership: the requester must own the open mic
      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own this open mic');
      }

      const created = await withTransaction(pool, async (client) => {
        return insertEvent(client, {
          openMicId: openMic.id,
          title: input.title,
          startsAt: input.starts_at,
          endsAt: input.ends_at,
          timeZone: input.time_zone,
          running: input.running,
          registrationsClosedAt: input.registrations_closed_at,
          // Location snapshot: use provided overrides or inherit from parent open mic
          venueName: input.venue_name ?? openMic.venue_name,
          addressLine1: input.address_line1 ?? openMic.address_line1,
          addressLine2: input.address_line2 ?? openMic.address_line2,
          postcode: input.postcode ?? openMic.postcode,
          city: input.city ?? openMic.city,
          country: input.country ?? openMic.country,
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

  app.get<{ Params: { id: string } }>('/open-mics/:id/events', async (request, reply) => {
    const openMic = await findOpenMicById(pool, request.params.id);
    if (!openMic || openMic.status === 'draft' || openMic.status === 'ended') throw new NotFoundError('Open mic not found');

    const events = await findEventsByOpenMicId(pool, openMic.id);
    reply.send(events.map(serializeEvent));
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id/next-event', async (request, reply) => {
    const openMic = await findOpenMicById(pool, request.params.id);
    if (!openMic || openMic.status === 'draft' || openMic.status === 'ended') throw new NotFoundError('Open mic not found');
    const event = await findNextEventByOpenMicId(pool, openMic.id);
    if (!event) throw new NotFoundError('No upcoming event found');
    reply.send(serializeEvent(event));
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
      reply.send(events.map(serializeEvent));
    },
  );

  app.get<{ Params: { id: string } }>('/events/:id', async (request, reply) => {
    const event = await findEventByIdOrPublicCode(pool, request.params.id);
    if (!event) throw new NotFoundError('Event not found');
    const openMic = await findOpenMicById(pool, event.open_mic_id);
    if (!openMic || openMic.status === 'draft' || openMic.status === 'ended') throw new NotFoundError('Event not found');
    reply.send(serializeEvent(event));
  });

  app.get<{ Params: { id: string; eventId: string } }>('/open-mics/:id/events/:eventId', async (request, reply) => {
    const event = await findEventByIdOrPublicCode(pool, request.params.eventId);
    if (!event || event.open_mic_id !== request.params.id) throw new NotFoundError('Event not found');
    reply.send(serializeEvent(event));
  });

  app.patch<{ Params: { id: string; eventId: string } }>(
    '/open-mics/:id/events/:eventId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = updateEventSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid event payload', parsed.error.flatten());

      const existing = await findEventById(pool, request.params.eventId);
      if (!existing || existing.open_mic_id !== request.params.id) throw new NotFoundError('Event not found');

      // Verify ownership via the parent open mic
      const openMic = await findOpenMicById(pool, existing.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');

      const account = request.account!;
      const ownerProfile = await findOpenMicOwnerAccountId(pool, openMic.owner_profile_id);
      if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
        throw new ForbiddenError('You do not own the parent open mic');
      }

      const changes: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) changes.title = parsed.data.title;
      if (parsed.data.starts_at !== undefined) changes.startsAt = parsed.data.starts_at;
      if (parsed.data.ends_at !== undefined) changes.endsAt = parsed.data.ends_at;
      if (parsed.data.time_zone !== undefined) changes.timeZone = parsed.data.time_zone;
      if (parsed.data.running !== undefined) changes.running = parsed.data.running;
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

      const updated = await updateEvent(pool, request.params.eventId, changes as any);
      if (!updated) throw new NotFoundError('Event not found after update');

      reply.send(serializeEvent(updated));
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
