import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { findEventById } from '../events/repository.js';
import { notifyRoster } from '../events/roster-stream.js';
import { findOpenMicById } from '../open-mics/repository.js';
import { findRegistrationById, softDeleteRegistration } from '../registrations/repository.js';
import {
  countOtherPerformancesForRegistration,
  findPerformanceById,
  findPerformancesByRegistrationId,
  insertPerformance,
  lastPerformed,
  nextSequenceForColumn,
  serializePerformance,
  softDeletePerformance,
  topOfScheduled,
  updatePerformance,
} from './repository.js';
import { createPerformanceSchema, updatePerformanceSchema } from './validation.js';

// Statuses that carry their own bottom-of-column running order (see nextSequenceForColumn).
const SEQUENCED_STATUSES = new Set(['present', 'scheduled']);

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
    // A performer can only have one card "in flight" at a time: a second set (this endpoint's
    // only caller — the initial performance per registration is created directly alongside the
    // registration itself, not through here) is rejected while another of this registration's
    // performances is still active (anything short of performed/no_show/cancelled).
    const existingPerformances = await findPerformancesByRegistrationId(pool, parsed.data.registration_id);
    const hasActivePerformance = existingPerformances.some((row) => !['performed', 'no_show', 'cancelled'].includes(row.status));
    if (hasActivePerformance) {
      throw new ValidationError('This registration already has a performance in progress');
    }
    const created = await insertPerformance(pool, {
      registrationId: parsed.data.registration_id,
      eventId: context.event.id,
      name: parsed.data.name,
      activity: parsed.data.activity,
      sequence: parsed.data.sequence,
      status: parsed.data.status,
      notes: parsed.data.notes,
    });
    reply.status(201).send(serializePerformance(created, true));
    void notifyRoster(pool, context.event.id, 'performance.created', { performance_id: created.id, registration_id: created.registration_id }).catch(
      (error) => app.log.error({ error }, 'Failed to publish roster notification'),
    );
  });

  app.put<{ Params: { id: string } }>('/performances/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updatePerformanceSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid performance payload', parsed.error.flatten());
    const existing = await findPerformanceById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Performance not found');
    const context = await assertOrganizer(pool, existing.registration_id, request.account!.accountId, request.account!.isPlatformAdmin);
    assertActivityAllowed(parsed.data.activity, context.event.activities, context.openMic.activities);

    // Only the top-of-queue Scheduled card may start performing via the ordinary forward move —
    // this doesn't apply to the "resume from Performed" fix-up path handled below.
    if (parsed.data.status === 'performing' && existing.status === 'scheduled') {
      const top = await topOfScheduled(pool, context.event.id);
      if (!top || top.id !== existing.id) {
        throw new ValidationError('Only the performer at the top of the Scheduled column can start performing');
      }
    }
    // Performed has no sequence of its own (order is implied by finished_at); only the most
    // recently finished card may be moved back out, covering the "moved too early" fix-up case.
    if (existing.status === 'performed' && parsed.data.status !== undefined && parsed.data.status !== 'performed') {
      const last = await lastPerformed(pool, context.event.id);
      if (!last || last.id !== existing.id) {
        throw new ValidationError('Only the most recently performed card can be moved out of Performed');
      }
    }
    // A pure reorder (sequence only, no status change) is only meaningful in Present/Scheduled —
    // Performed has no sequence, and the other columns don't support manual reordering.
    if (parsed.data.sequence !== undefined && parsed.data.status === undefined && existing.status !== 'present' && existing.status !== 'scheduled') {
      throw new ValidationError('Reordering is only allowed in the Present or Scheduled columns');
    }

    // Moving into "present" or "scheduled" needs a shared bottom-of-column running-order number
    // so every organizer viewing the roster sees the same queue order; see nextSequenceForColumn
    // for why this is safe to leave untouched afterwards within that column.
    const changes = { ...parsed.data };
    if ((changes.status === 'scheduled' || changes.status === 'present') && changes.sequence === undefined) {
      changes.sequence = await nextSequenceForColumn(pool, context.event.id, changes.status);
    }
    const updated = await updatePerformance(pool, existing.id, changes, existing.status);
    reply.send(serializePerformance(updated!, true));
    // "reordered" is a more specific event than "updated" for the common case of only the
    // running-order position changing; other field changes fall back to the generic event.
    const onlySequenceChanged = parsed.data.sequence !== undefined && Object.keys(parsed.data).length === 1;
    void notifyRoster(
      pool,
      context.event.id,
      onlySequenceChanged ? 'performance.reordered' : 'performance.updated',
      { performance_id: updated!.id, registration_id: updated!.registration_id },
    ).catch((error) => app.log.error({ error }, 'Failed to publish roster notification'));
  });

  app.delete<{ Params: { id: string } }>('/performances/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const existing = await findPerformanceById(pool, request.params.id);
    if (!existing) throw new NotFoundError('Performance not found');
    const context = await assertOrganizer(pool, existing.registration_id, request.account!.accountId, request.account!.isPlatformAdmin);
    const deleted = await softDeletePerformance(pool, existing.id, context.openMic.owner_profile_id);
    if (!deleted) throw new NotFoundError('Performance not found');
    // A performer's card is a registration+performance pair, so deleting their only remaining
    // performance leaves a registration with nothing to show — rather than leave that orphaned
    // row around, delete the registration itself too (they'd need to register again for a future
    // set, same as any other from-scratch registration). Other performances (past sets, or ones
    // still in progress elsewhere) mean this was just "delete this one set" instead. This must
    // complete before the response is sent, so a client's immediate follow-up GET always sees
    // the final, consistent state rather than racing this cascade.
    const remaining = await countOtherPerformancesForRegistration(pool, existing.registration_id, existing.id);
    const registrationDeleted = remaining === 0
      ? await softDeleteRegistration(pool, existing.registration_id, context.openMic.owner_profile_id)
      : null;
    reply.status(204).send();
    void notifyRoster(pool, context.event.id, 'performance.deleted', { performance_id: existing.id, registration_id: existing.registration_id }).catch(
      (error) => app.log.error({ error }, 'Failed to publish roster notification'),
    );
    if (registrationDeleted) {
      void notifyRoster(pool, context.event.id, 'registration.deleted', { registration_id: existing.registration_id }).catch(
        (error) => app.log.error({ error }, 'Failed to publish roster notification'),
      );
    }
  });
};
