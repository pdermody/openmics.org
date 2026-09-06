import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { parseGeoFilter } from '../geo.js';
import { assignHandle } from '../handles/service.js';
import { requireOwnedProfile } from '../profiles/current-profile.js';
import { findOpenMicById, findPublicOpenMics, insertOpenMic, serializeOpenMic, updateOpenMic } from './repository.js';
import { createOpenMicSchema, updateOpenMicSchema } from './validation.js';

export type OpenMicsPluginOptions = { pool: Pool };

export const openMicsRoutes: FastifyPluginAsync<OpenMicsPluginOptions> = async (app, { pool }) => {
  app.post('/open-mics', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createOpenMicSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid open mic payload', parsed.error.flatten());
    const input = parsed.data;

    const ownerProfile = await requireOwnedProfile(pool, request, { profileKind: 'organizer' });

    const withHandle = await withTransaction(pool, async (client) => {
      const openMic = await insertOpenMic(client, {
        ownerProfileId: ownerProfile.id,
        name: input.name,
        description: input.description,
        activities: input.activities,
        tags: input.tags,
        venueName: input.venue_name,
        addressLine1: input.address_line1,
        addressLine2: input.address_line2,
        postcode: input.postcode,
        city: input.city,
        country: input.country,
        lat: input.lat,
        lng: input.lng,
        timeZone: input.time_zone,
        website: input.website,
        contactEmail: input.contact_email,
        scheduleSummary: input.schedule_summary,
        scheduleDetails: input.schedule_details,
        originalsOnly: input.originals_only,
        amplificationAvailable: input.amplification_available,
        agePolicy: input.age_policy,
        registrationMode: input.registration_mode,
        externalRegistrationUrl: input.external_registration_url,
        entryFeeAmount: input.entry_fee_amount,
        entryFeeCurrency: input.entry_fee_currency,
        entryFeeNote: input.entry_fee_note,
      });
      await assignHandle(
        client,
        { entityType: 'open_mic', openMicId: openMic.id },
        { displayName: input.name, requestedHandle: input.handle },
      );
      return findOpenMicById(client, openMic.id);
    });

    reply.status(201).send(serializeOpenMic(withHandle!));
  });

  app.get<{ Querystring: { page?: string; page_size?: string; q?: string; country?: string; city?: string; activity?: string; tag?: string; registration_mode?: string; near?: string; radius_km?: string } }>('/open-mics', async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(request.query.page_size ?? 25)));
    const geo = parseGeoFilter(request.query.near, request.query.radius_km);
    const result = await findPublicOpenMics(pool, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      q: request.query.q,
      country: request.query.country,
      city: request.query.city,
      activity: request.query.activity,
      tag: request.query.tag,
      registrationMode: request.query.registration_mode,
      geo,
    });
    reply.send({
      items: result.rows.map(serializeOpenMic),
      pagination: { page, page_size: pageSize, total: result.total },
    });
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id', async (request, reply) => {
    const openMic = await findOpenMicById(pool, request.params.id);
    if (!openMic) throw new NotFoundError('Open mic not found');
    reply.send(serializeOpenMic(openMic));
  });

  app.patch<{ Params: { id: string } }>('/open-mics/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updateOpenMicSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid open mic payload', parsed.error.flatten());

    const existing = await findOpenMicById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Open mic not found');

    const account = request.account!;
    const ownerProfile = await findOpenMicOwnerAccountId(pool, existing.owner_profile_id);
    if (ownerProfile !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this open mic');
    }

    const updated = await updateOpenMic(pool, request.params.id, parsed.data);
    reply.send(serializeOpenMic(updated!));
  });
};

async function findOpenMicOwnerAccountId(pool: Pool, ownerProfileId: string): Promise<string | null> {
  const result = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1',
    [ownerProfileId],
  );
  return result.rows[0]?.created_by_account_id ?? null;
}
