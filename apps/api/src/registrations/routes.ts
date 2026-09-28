import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import type { EmailAdapter } from '../email/index.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import { findEventById, findEventByIdOrPublicCode } from '../events/repository.js';
import { notifyRoster, verifyKioskRegistrationToken } from '../events/roster-stream.js';
import { findOpenMicById } from '../open-mics/repository.js';
import { findPerformancesByRegistrationIds, insertPerformance, serializePerformance } from '../performances/repository.js';
import { findProfileById } from '../profiles/repository.js';
import {
  findClaimableRegistrations,
  findRegistrationById,
  findRegistrationByToken,
  findRegistrationsByEventId,
  findRegistrationsByProfileId,
  insertRegistration,
  serializeRegistration,
  softDeleteRegistration,
  updateRegistration,
} from './repository.js';
import { claimRegistrationSchema, createRegistrationSchema, updateRegistrationSchema, verifyEmailSchema } from './validation.js';

export type RegistrationsPluginOptions = { pool: Pool; emailAdapter: EmailAdapter; appBaseUrl: string; streamTokenSecret: string };

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function tokenPair(ttlMs: number) {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieToken(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  const match = header?.match(/(?:^|;\s*)openmic_edit_session=([^;]+)/);
  return match?.[1];
}

async function accountEmail(pool: Pool, accountId: string): Promise<string> {
  const result = await pool.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [accountId]);
  if (!result.rows[0]) throw new UnauthorizedError('Authenticated account not found');
  return result.rows[0].email;
}

async function ownerAccountId(pool: Pool, ownerProfileId: string): Promise<string> {
  const result = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1 AND deleted_at IS NULL',
    [ownerProfileId],
  );
  if (!result.rows[0]) throw new NotFoundError('Owner profile not found');
  return result.rows[0].created_by_account_id;
}

async function assertEventOwner(pool: Pool, eventId: string, accountId: string, isAdmin: boolean): Promise<void> {
  const event = await findEventById(pool, eventId);
  if (!event) throw new NotFoundError('Event not found');
  const openMic = await findOpenMicById(pool, event.open_mic_id);
  if (!openMic) throw new NotFoundError('Parent open mic not found');
  if (!isAdmin && (await ownerAccountId(pool, openMic.owner_profile_id)) !== accountId) {
    throw new ForbiddenError('You do not own this event');
  }
}

async function assertRegistrationAccess(pool: Pool, request: FastifyRequest, registrationId: string) {
  const registration = await findRegistrationById(pool, registrationId);
  if (!registration) throw new NotFoundError('Registration not found');
  if (request.account) {
    if (registration.claimed_by_account_id === request.account.accountId) return registration;
    await assertEventOwner(pool, registration.event_id, request.account.accountId, request.account.isPlatformAdmin);
    return registration;
  }

  const token = cookieToken(request);
  if (!token || !registration.edit_token_hash || registration.edit_token_hash !== hashToken(token)) {
    throw new UnauthorizedError('Registration edit session required');
  }
  if (!registration.edit_token_expires_at || registration.edit_token_expires_at.getTime() <= Date.now()) {
    throw new UnauthorizedError('Registration edit session expired');
  }
  return registration;
}

export const registrationsRoutes: FastifyPluginAsync<RegistrationsPluginOptions> = async (app, { pool, emailAdapter, appBaseUrl, streamTokenSecret }) => {
  app.post<{ Params: { id: string } }>(
    '/events/:id/registrations',
    { preHandler: app.authenticateOptional },
    async (request, reply) => {
      const parsed = createRegistrationSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid registration payload', parsed.error.flatten());
      const input = parsed.data;
      const event = await findEventByIdOrPublicCode(pool, request.params.id);
      if (!event) throw new NotFoundError('Event not found');
      const openMic = await findOpenMicById(pool, event.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');
      if (input.kiosk_token) {
        const claims = await verifyKioskRegistrationToken(streamTokenSecret, input.kiosk_token).catch(() => null);
        if (!claims || claims.eventId !== event.id) {
          throw new AppError(403, 'KIOSK_TOKEN_INVALID', 'This kiosk QR code has expired or is not valid for this event');
        }
      }
      // A valid kiosk token proves presence at the venue, like organizer supervision.
      const presenceVerified = input.organizer_supervised || Boolean(input.kiosk_token);
      if (!presenceVerified && (openMic.status !== 'active' || event.status !== 'published')) {
        throw new ConflictError('REGISTRATION_UNAVAILABLE', 'Registration is not available for this event');
      }
      if (!presenceVerified && !['pre_only', 'both'].includes(openMic.registration_mode)) {
        throw new ConflictError(
          'REGISTRATION_MODE_DISABLED',
          openMic.registration_mode === 'external'
            ? 'This open mic is using an external registration link.'
            : 'Online registration is not available for this open mic.',
        );
      }
      if (!presenceVerified && (!event.ends_at || new Date(event.ends_at).getTime() <= Date.now())) {
        throw new ConflictError('REGISTRATION_UNAVAILABLE', 'Registration is no longer available for this event');
      }
      if (!presenceVerified && event.registrations_closed_at && new Date(event.registrations_closed_at).getTime() <= Date.now()) {
        throw new ConflictError('REGISTRATIONS_CLOSED', 'Registrations are closed for this event');
      }

      let profileId = input.profile_id ?? null;
      let verificationMethod: string | null = null;
      let verifiedAt: Date | null = null;
      if (request.account && !profileId && !input.organizer_supervised) {
        throw new ValidationError('Select an account-owned performer profile to register', { field: 'profile_id' });
      }
      if (profileId) {
        if (!request.account) throw new UnauthorizedError('Authentication required for profile registration');
        const profile = await findProfileById(pool, profileId);
        if (!profile || profile.created_by_account_id !== request.account.accountId || profile.profile_kind !== 'performer') {
          throw new ForbiddenError('Profile registration requires an account-owned performer profile');
        }
        verificationMethod = 'authenticated_account';
        verifiedAt = new Date();
      } else if (input.kiosk_token) {
        verificationMethod = 'kiosk_qr';
        verifiedAt = new Date();
      }

      if (input.organizer_supervised) {
        if (!request.account) throw new UnauthorizedError('Authentication required for kiosk registration');
        const eventOwner = await findEventById(pool, event.id);
        const openMic = eventOwner && await findOpenMicById(pool, eventOwner.open_mic_id);
        if (!openMic || (await ownerAccountId(pool, openMic.owner_profile_id)) !== request.account.accountId) {
          throw new ForbiddenError('Only the event organizer can record kiosk registrations');
        }
        verificationMethod = 'organizer_kiosk';
        verifiedAt = new Date();
      }

      const editToken = !presenceVerified ? tokenPair(TOKEN_TTL_MS) : null;
      const verificationToken = !presenceVerified && !profileId ? tokenPair(VERIFICATION_TTL_MS) : null;
      try {
        const created = await withTransaction(pool, async (client) => {
          const lockedEvent = await client.query<{ capacity: string | null }>(
            'SELECT capacity FROM events WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
            [event.id],
          );
          if (!lockedEvent.rows[0]) throw new NotFoundError('Event not found');
          // Kiosk sign-ups are exempt from capacity but still count toward it for online sign-ups.
          if (!presenceVerified && lockedEvent.rows[0].capacity !== null) {
            const count = await client.query<{ count: string }>(
              'SELECT count(*)::text AS count FROM registrations WHERE event_id = $1 AND deleted_at IS NULL',
              [event.id],
            );
            if (Number(count.rows[0].count) >= Number(lockedEvent.rows[0].capacity)) {
              throw new ConflictError('CAPACITY_EXCEEDED', 'This event has reached capacity');
            }
          }
          if (input.contact_email) {
            const existingVerified = await client.query<{ id: string }>(
              `SELECT id FROM registrations
               WHERE event_id = $1 AND deleted_at IS NULL
                 AND email_verified_at IS NOT NULL AND lower(contact_email) = lower($2)
               LIMIT 1`,
              [event.id, input.contact_email],
            );
            if (existingVerified.rows[0]) {
              throw new ConflictError('DUPLICATE_REGISTRATION', 'A verified registration already exists for this event and email');
            }
          }
          const registration = await insertRegistration(client, {
            eventId: event.id,
            profileId,
            performerName: input.performer_name,
            performerCity: input.performer_city,
            contactEmail: input.contact_email?.toLowerCase(),
            contactPhone: input.contact_phone,
            songNames: input.song_names,
            bio: input.bio,
            submissionChannel: input.submission_channel,
            organizerSupervised: input.organizer_supervised,
            referredByProfileId: input.referred_by_profile_id,
            mediaConsent: input.media_consent,
            remindersOptIn: input.reminders_opt_in,
            editTokenHash: editToken?.hash,
            editTokenExpiresAt: editToken?.expiresAt,
            emailVerificationTokenHash: verificationToken?.hash,
            emailVerificationTokenExpiresAt: verificationToken?.expiresAt,
            verificationMethod,
            emailVerifiedAt: verifiedAt,
          });
          // Every registration is a performer, so it always gets a first performance slot up
          // front rather than requiring the organizer to add one manually. Kiosk sign-ups skip
          // straight to "present" since the organizer's physical presence already confirms it;
          // everyone else starts at "registered" and is checked in at the door later.
          await insertPerformance(client, {
            registrationId: registration.id,
            eventId: event.id,
            name: input.performer_name,
            status: presenceVerified ? 'present' : 'registered',
          });
          return registration;
        });
        reply.status(201).send(serializeRegistration(created));
        void notifyRoster(pool, event.id, 'registration.created', { registration_id: created.id }).catch((error) =>
          app.log.error({ error }, 'Failed to publish roster notification'),
        );
        if (input.contact_email && editToken && verificationToken) {
          const confirmUrl = new URL(`/events/${event.public_code}/register`, appBaseUrl);
          confirmUrl.searchParams.set('token', editToken.token);
          confirmUrl.searchParams.set('verify', verificationToken.token);
          void emailAdapter.send({
            to: input.contact_email,
            subject: `Confirm your spot at ${event.title}`,
            text: `Confirm your registration for ${event.title}: ${confirmUrl.toString()}\n\nThis link also lets you edit your registration later. It expires in 7 days.`,
            html: `<p>Confirm your registration for <strong>${event.title}</strong>:</p><p><a href="${confirmUrl.toString()}">${confirmUrl.toString()}</a></p><p>This link also lets you edit your registration later. It expires in 7 days.</p>`,
          }).catch((error) => app.log.error({ error }, 'Failed to send registration confirmation email'));
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictError('DUPLICATE_REGISTRATION', 'A verified registration already exists for this event and email');
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/events/:id/registrations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      await assertEventOwner(pool, request.params.id, request.account!.accountId, request.account!.isPlatformAdmin);
      const registrations = await findRegistrationsByEventId(pool, request.params.id);
      // Roster page needs each registration's performances (sequence/status/notes) in one
      // round trip; batch-fetch by registration id rather than one query per row.
      const performances = await findPerformancesByRegistrationIds(pool, registrations.map((registration) => registration.id));
      const performancesByRegistration = new Map<string, typeof performances>();
      for (const performance of performances) {
        const list = performancesByRegistration.get(performance.registration_id) ?? [];
        list.push(performance);
        performancesByRegistration.set(performance.registration_id, list);
      }
      reply.send(
        registrations.map((registration) => ({
          ...serializeRegistration(registration),
          performances: (performancesByRegistration.get(registration.id) ?? []).map((performance) => serializePerformance(performance, true)),
        })),
      );
    },
  );

  app.get('/me/claimable-registrations', { preHandler: app.authenticate }, async (request, reply) => {
    const email = await accountEmail(pool, request.account!.accountId);
    reply.send((await findClaimableRegistrations(pool, email)).map((registration) => ({
      ...serializeRegistration(registration),
      event_title: registration.event_title,
      event_starts_at: registration.event_starts_at,
      open_mic_name: registration.open_mic_name,
    })));
  });

  app.get<{ Querystring: { profile?: string } }>('/me/registrations', { preHandler: app.authenticate }, async (request, reply) => {
    const profileId = request.query.profile;
    if (!profileId) throw new ValidationError('profile query parameter is required', { field: 'profile' });
    const profile = await findProfileById(pool, profileId);
    if (!profile || (profile.created_by_account_id !== request.account!.accountId && !request.account!.isPlatformAdmin)) {
      throw new ForbiddenError('You do not own the profile specified in the profile query parameter');
    }
    reply.send((await findRegistrationsByProfileId(pool, profileId)).map(serializeRegistration));
  });

  app.get<{ Querystring: { token: string } }>('/registrations/edit', async (request, reply) => {
    const token = request.query.token;
    if (!token) throw new ValidationError('Edit token is required');
    const registration = await findRegistrationByToken(pool, 'edit_token_hash', hashToken(token));
    if (!registration || !registration.edit_token_expires_at || registration.edit_token_expires_at.getTime() <= Date.now()) {
      throw new NotFoundError('Registration edit link not found or expired');
    }
    reply
      .header('Set-Cookie', `openmic_edit_session=${token}; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; Path=/api; HttpOnly; Secure; SameSite=Lax`)
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .send(serializeRegistration(registration));
  });

  app.get<{ Params: { id: string } }>(
    '/registrations/:id',
    { preHandler: app.authenticateOptional },
    async (request, reply) => reply.send(serializeRegistration(await assertRegistrationAccess(pool, request, request.params.id))),
  );

  app.patch<{ Params: { id: string } }>(
    '/registrations/:id',
    { preHandler: app.authenticateOptional },
    async (request, reply) => {
      const parsed = updateRegistrationSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid registration payload', parsed.error.flatten());
      const registration = await assertRegistrationAccess(pool, request, request.params.id);
      if (parsed.data.adopted_profile_id !== undefined && !request.account) {
        throw new UnauthorizedError('Authentication required to change public attribution');
      }
      if (parsed.data.adopted_profile_id !== undefined && request.account) {
        if (registration.claimed_by_account_id !== request.account.accountId) {
          throw new ForbiddenError('Only the registration owner can change public attribution');
        }
        if (parsed.data.adopted_profile_id) {
          const profile = await findProfileById(pool, parsed.data.adopted_profile_id);
          if (!profile || profile.created_by_account_id !== request.account.accountId || profile.profile_kind !== 'performer') {
            throw new ForbiddenError('Adopted profile must be an account-owned performer profile');
          }
        }
      }
      const changes = { ...parsed.data, media_consent_updated_at: undefined };
      const updated = await updateRegistration(pool, registration.id, changes);
      reply.send(serializeRegistration(updated!));
      void notifyRoster(pool, updated!.event_id, 'registration.updated', { registration_id: updated!.id }).catch((error) =>
        app.log.error({ error }, 'Failed to publish roster notification'),
      );
    },
  );

  // Organizer-only: removes a registration entirely (roster "Delete" action). Only offered for
  // still-registered performers, before anything else has happened, so this intentionally uses
  // the stricter event-owner check rather than assertRegistrationAccess (which also allows the
  // registration's own claimed-by account — deleting someone else's registration isn't theirs
  // to do). Soft-deleted with the same 30-day recovery window as events/performances.
  app.delete<{ Params: { id: string } }>(
    '/registrations/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const existing = await findRegistrationById(pool, request.params.id);
      if (!existing) throw new NotFoundError('Registration not found');
      const event = await findEventById(pool, existing.event_id);
      if (!event) throw new NotFoundError('Event not found');
      const openMic = await findOpenMicById(pool, event.open_mic_id);
      if (!openMic) throw new NotFoundError('Parent open mic not found');
      if (!request.account!.isPlatformAdmin && (await ownerAccountId(pool, openMic.owner_profile_id)) !== request.account!.accountId) {
        throw new ForbiddenError('You do not own this event');
      }
      const deleted = await softDeleteRegistration(pool, existing.id, openMic.owner_profile_id);
      if (!deleted) throw new NotFoundError('Registration not found');
      reply.status(204).send();
      void notifyRoster(pool, existing.event_id, 'registration.deleted', { registration_id: existing.id }).catch((error) =>
        app.log.error({ error }, 'Failed to publish roster notification'),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/registrations/:id/verify-email',
    async (request, reply) => {
      const parsed = verifyEmailSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid verification payload', parsed.error.flatten());
      const registration = await findRegistrationByToken(pool, 'email_verification_token_hash', hashToken(parsed.data.token));
      if (!registration || !registration.email_verification_token_expires_at || registration.email_verification_token_expires_at.getTime() <= Date.now()) {
        throw new NotFoundError('Verification token not found or expired');
      }
      const updated = await updateRegistration(pool, registration.id, {
        email_verified_at: new Date(),
        verification_method: 'email',
        email_verification_token_hash: null,
        email_verification_token_expires_at: null,
      });
      reply.send(serializeRegistration(updated!));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/registrations/:id/claim',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = claimRegistrationSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError('Invalid claim payload', parsed.error.flatten());
      const registration = await findRegistrationById(pool, request.params.id);
      if (!registration) throw new NotFoundError('Registration not found');
      const email = await accountEmail(pool, request.account!.accountId);
      if (!registration.email_verified_at || !registration.contact_email || registration.contact_email.toLowerCase() !== email.toLowerCase()) {
        throw new ForbiddenError('Only the verified contact account can claim this registration');
      }
      if (registration.claimed_by_account_id && registration.claimed_by_account_id !== request.account!.accountId) {
        throw new ConflictError('REGISTRATION_ALREADY_CLAIMED', 'This registration has already been claimed');
      }
      const adoptedProfileId = parsed.data.adopted_profile_id;
      const profile = await findProfileById(pool, adoptedProfileId);
      if (!profile || profile.created_by_account_id !== request.account!.accountId || profile.profile_kind !== 'performer') {
        throw new ForbiddenError('Adopted profile must be an account-owned performer profile');
      }
      const changes: Record<string, unknown> = {
        claimed_by_account_id: request.account!.accountId,
        claimed_at: new Date(),
        adopted_profile_id: adoptedProfileId,
      };
      if (parsed.data.sync_public_fields) {
        changes.performer_name = profile.profile_name;
      }
      const updated = await updateRegistration(pool, registration.id, changes);
      reply.send(serializeRegistration(updated!));
      void notifyRoster(pool, updated!.event_id, 'registration.updated', { registration_id: updated!.id }).catch((error) =>
        app.log.error({ error }, 'Failed to publish roster notification'),
      );
    },
  );
};
