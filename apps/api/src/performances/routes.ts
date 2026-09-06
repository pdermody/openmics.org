import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { findEventById } from '../events/repository.js';
import { findOpenMicById } from '../open-mics/repository.js';
import { findRegistrationById } from '../registrations/repository.js';
import {
  findPerformanceById,
  findPerformancesByRegistrationId,
  insertPerformance,
  serializePerformance,
  softDeletePerformance,
  updatePerformance,
} from './repository.js';
import { createPerformanceSchema, updatePerformanceSchema } from './validation.js';

export type PerformancesPluginOptions = { pool: Pool };

async function registrationContext(pool: Pool, registrationId: string) {
  const registration = await findRegistrationById(pool, registrationId);
  if (!registration) throw new NotFoundError('Registration not found');
  const event = await findEventById(pool, registration.event_id);
  if (!event) throw new NotFoundError('Event not found');
  const openMic = await findOpenMicById(pool, event.open_mic_id);
  if (!openMic) throw new NotFoundError('Parent open mic not found');
  return { registration, event, openMic };
}

async function assertOrganizer(pool: Pool, registrationId: string, accountId: string, isAdmin: boolean) {
  const context = await registrationContext(pool, registrationId);
  const owner = await pool.query<{ created_by_account_id: string }>(
    'SELECT created_by_account_id FROM profiles WHERE id = $1 AND deleted_at IS NULL',
    [context.openMic.owner_profile_id],
  );
  if (!owner.rows[0]) throw new NotFoundError('Owner profile not found');
  if (!isAdmin && owner.rows[0].created_by_account_id !== accountId) {
    throw new ForbiddenError('Only the event organizer can manage performances');
  }
  return context;
}

function assertActivityAllowed(activity: string | null | undefined, eventActivities: string[] | null, openMicActivities: string[]) {
  if (!activity) return;
  const effectiveActivities = eventActivities && eventActivities.length > 0 ? eventActivities : openMicActivities;
  if (!effectiveActivities.includes(activity)) {
    throw new ValidationError('Performance activity is not enabled for this event', { field: 'activity' });
  }
}

export const performancesRoutes: FastifyPluginAsync<PerformancesPluginOptions> = async (app, { pool }) => {
  app.get<{ Params: { id: string } }>(
    '/registrations/:id/performances',
    { preHandler: app.authenticateOptional },
    async (request, reply) => {
      const context = await registrationContext(pool, request.params.id);
      const isOrganizer = request.account
        ? await (async () => {
            const owner = await pool.query<{ created_by_account_id: string }>(
              'SELECT created_by_account_id FROM profiles WHERE id = $1 AND deleted_at IS NULL',
              [context.openMic.owner_profile_id],
            );
            return Boolean(owner.rows[0] && (request.account!.isPlatformAdmin || owner.rows[0].created_by_account_id === request.account!.accountId));
          })()
        : false;
      if (!context.registration.organizer_supervised && !context.registration.email_verified_at && !isOrganizer) {
        throw new NotFoundError('Registration not found');
      }
      reply.send((await findPerformancesByRegistrationId(pool, request.params.id)).map((row) => serializePerformance(row, isOrganizer)));
    },
  );

  app.post('/performances', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createPerformanceSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid performance payload', parsed.error.flatten());
    const context = await assertOrganizer(pool, parsed.data.registration_id, request.account!.accountId, request.account!.isPlatformAdmin);
    assertActivityAllowed(parsed.data.activity, context.event.activities, context.openMic.activities);
    const created = await insertPerformance(pool, {
      registrationId: parsed.data.registration_id,
      name: parsed.data.name,
      activity: parsed.data.activity,
      sequence: parsed.data.sequence,
      status: parsed.data.status,
      notes: parsed.data.notes,
    });
    reply.status(201).send(serializePerformance(created, true));
  });

  app.put<{ Params: { id: string } }>('/performances/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updatePerformanceSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid performance payload', parsed.error.flatten());
    const existing = await findPerformanceById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Performance not found');
    const context = await assertOrganizer(pool, existing.registration_id, request.account!.accountId, request.account!.isPlatformAdmin);
    assertActivityAllowed(parsed.data.activity, context.event.activities, context.openMic.activities);
    const updated = await updatePerformance(pool, existing.id, parsed.data);
    reply.send(serializePerformance(updated!, true));
  });

  app.delete<{ Params: { id: string } }>('/performances/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const existing = await findPerformanceById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Performance not found');
    const context = await assertOrganizer(pool, existing.registration_id, request.account!.accountId, request.account!.isPlatformAdmin);
    const deleted = await softDeletePerformance(pool, existing.id, context.openMic.owner_profile_id);
    if (!deleted) throw new NotFoundError('Performance not found');
    reply.status(204).send();
  });
};
