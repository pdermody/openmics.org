import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { parseGeoFilter } from '../geo.js';
import { assignHandle } from '../handles/service.js';
import { requireOwnedProfile } from '../profiles/current-profile.js';
import { findProfileById } from '../profiles/repository.js';
import { findOpenMicById, findOpenMicByIdOrPublicCode, findOwnedOpenMics, findPublicOpenMics, getKioskBackupPin, insertOpenMic, serializeOpenMic, setKioskBackupPin, softDeleteOpenMic, updateOpenMic } from './repository.js';
import { createOpenMicSchema, kioskBackupPinSchema, updateOpenMicSchema } from './validation.js';

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

  app.get<{ Querystring: { page?: string; page_size?: string; q?: string; country?: string; city?: string; activity?: string; tag?: string; registration_mode?: string; owner_profile_id?: string; near?: string; radius_km?: string } }>('/open-mics', async (request, reply) => {
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
      ownerProfileId: request.query.owner_profile_id,
      geo,
    });
    reply.send({
      items: result.rows.map(serializeOpenMic),
      pagination: { page, page_size: pageSize, total: result.total },
    });
  });

  // The public directory listing above always excludes draft/ended series (see
  // docs/architecture/api-design.md), so an organizer's own dashboard cannot use it to see a
  // just-created (draft) series. This authenticated endpoint returns every non-deleted series
  // owned by a profile the caller owns, regardless of status.
  app.get<{ Querystring: { owner_profile_id?: string } }>('/me/open-mics', { preHandler: app.authenticate }, async (request, reply) => {
    const ownerProfileId = request.query.owner_profile_id;
    if (!ownerProfileId) throw new ValidationError('owner_profile_id is required', { field: 'owner_profile_id' });

    const account = request.account!;
    const profile = await findProfileById(pool, ownerProfileId);
    if (!profile) throw new NotFoundError('Profile not found');
    if (profile.created_by_account_id !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this profile');
    }

    const rows = await findOwnedOpenMics(pool, ownerProfileId);
    reply.send({
      items: rows.map(serializeOpenMic),
      pagination: { page: 1, page_size: Math.max(rows.length, 1), total: rows.length },
    });
  });

  app.get<{ Params: { id: string } }>('/open-mics/:id', async (request, reply) => {
    const openMic = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!openMic) throw new NotFoundError('Open mic not found');
    reply.send(serializeOpenMic(openMic));
  });

  app.patch<{ Params: { id: string } }>('/open-mics/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updateOpenMicSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid open mic payload', parsed.error.flatten());

    const existing = await requireOwnedOpenMic(request);

    const updated = await updateOpenMic(pool, existing.id, parsed.data);
    reply.send(serializeOpenMic(updated!));
  });

  app.delete<{ Params: { id: string } }>('/open-mics/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const openMic = await requireOwnedOpenMic(request);
    if (openMic.status !== 'paused') throw new ValidationError('Only paused series can be deleted');
    if (!(await softDeleteOpenMic(pool, openMic.id))) throw new NotFoundError('Open mic not found');
    reply.code(204).send();
  });

  // Kiosk backup PIN: configured server-side per series (not per-device), so it's the organizer's
  // fallback if they forget the fresh one-time PIN they choose each time they open the kiosk (see
  // KioskPage.tsx). Routine status/public reads omit the stored PIN; only the separate
  // owner-authenticated reveal route returns it after an explicit request.
  app.get<{ Params: { id: string } }>('/open-mics/:id/kiosk-backup-pin', { preHandler: app.authenticate }, async (request, reply) => {
    const openMic = await requireOwnedOpenMic(request);
    reply.send({ configured: Boolean(await getKioskBackupPin(pool, openMic.id)) });
  });

  app.post<{ Params: { id: string } }>('/open-mics/:id/kiosk-backup-pin/reveal', { preHandler: app.authenticate }, async (request, reply) => {
    const openMic = await requireOwnedOpenMic(request);
    const pin = await getKioskBackupPin(pool, openMic.id);
    if (pin === null) throw new ConflictError('KIOSK_BACKUP_PIN_NOT_CONFIGURED', 'No backup PIN is configured for this series');
    reply.header('Cache-Control', 'no-store').send({ pin });
  });

  app.put<{ Params: { id: string } }>('/open-mics/:id/kiosk-backup-pin', { preHandler: app.authenticate }, async (request, reply) => {
    const openMic = await requireOwnedOpenMic(request);
    const parsed = kioskBackupPinSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid PIN payload', parsed.error.flatten());
    await setKioskBackupPin(pool, openMic.id, parsed.data.pin);
    reply.send({ configured: true });
  });

  app.post<{ Params: { id: string } }>('/open-mics/:id/kiosk-backup-pin/verify', { preHandler: app.authenticate }, async (request, reply) => {
    const openMic = await requireOwnedOpenMic(request);
    const parsed = kioskBackupPinSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid PIN payload', parsed.error.flatten());
    const stored = await getKioskBackupPin(pool, openMic.id);
    reply.send({ valid: stored !== null && stored === parsed.data.pin });
  });

  async function requireOwnedOpenMic(request: FastifyRequest<{ Params: { id: string } }>) {
    const existing = await findOpenMicByIdOrPublicCode(pool, request.params.id);
    if (!existing) throw new NotFoundError('Open mic not found');

    const account = request.account!;
    const ownerAccountId = await findOpenMicOwnerAccountId(pool, existing.owner_profile_id);
    if (ownerAccountId !== account.accountId && !account.isPlatformAdmin) {
      throw new ForbiddenError('You do not own this open mic');
    }
    return existing;
  }
};

async function findOpenMicOwnerAccountId(pool: Pool, ownerProfileId: string): Promise<string | null> {
  const result = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1',
    [ownerProfileId],
  );
  return result.rows[0]?.created_by_account_id ?? null;
}
