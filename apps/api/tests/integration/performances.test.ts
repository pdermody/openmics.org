import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('performance routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let registrationId: string;
  let performanceId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('performance-owner', 'performance-owner@example.test') RETURNING id",
    );
    const outsider = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('performance-outsider', 'performance-outsider@example.test') RETURNING id",
    );
    const ownerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Performance Organizer', 'organizer') RETURNING id",
      [owner.rows[0].id],
    );
    await pool.query(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Outsider', 'organizer')",
      [outsider.rows[0].id],
    );
    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone)
       VALUES ($1, 'Performance Open Mic', ARRAY['singing'], 'Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin')
       RETURNING id`,
      [ownerProfile.rows[0].id],
    );
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country, activities)
       VALUES ($1, 'Performance Event', now() + interval '7 days', 'Europe/Dublin', 'Venue', '1 Test Street', 'Dublin', 'IE', ARRAY['singing'])
       RETURNING id`,
      [openMic.rows[0].id],
    );
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id, performer_name, submission_channel, organizer_supervised, verification_method, email_verified_at)
       VALUES ($1, 'Performer', 'kiosk', true, 'organizer_kiosk', now()) RETURNING id`,
      [event.rows[0].id],
    );
    registrationId = registration.rows[0].id;
    app = buildApp({ db: pool, logger: false, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(database);
  }, 30_000);

  it('creates and publicly lists a performance without exposing organizer notes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer performance-owner' },
      payload: { registration_id: registrationId, name: 'Opening song', activity: 'singing', notes: 'Mic check first' },
    });
    expect(created.statusCode).toBe(201);
    performanceId = created.json().id;
    expect(created.json().notes).toBe('Mic check first');

    const listed = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()[0].name).toBe('Opening song');
    expect(listed.json()[0].notes).toBeUndefined();
  });

  it('rejects activities outside the event activity set', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer performance-owner' },
      payload: { registration_id: registrationId, name: 'Poem', activity: 'poetry' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('allows the organizer to update and soft-delete a performance, leaving the registration and its other performance intact', async () => {
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/performances/${performanceId}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'performed' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe('performed');

    // A second performance for the same registration means deleting the first one is just "delete this set" — the registration (and the other performance) stays.
    const secondSet = await app.inject({ method: 'POST', url: '/api/performances', headers: { authorization: 'Bearer performance-owner' }, payload: { registration_id: registrationId, name: 'Encore', status: 'registered' } });
    expect(secondSet.statusCode).toBe(201);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/performances/${performanceId}`,
      headers: { authorization: 'Bearer performance-owner' },
    });
    expect(deleted.statusCode).toBe(204);
    const listed = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances` });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].id).toBe(secondSet.json().id);
  });

  it('deletes the registration too when its last remaining performance is deleted', async () => {
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id, performer_name, submission_channel, organizer_supervised, verification_method, email_verified_at)
       VALUES ((SELECT event_id FROM registrations WHERE id = $1), 'Solo Performer', 'kiosk', true, 'organizer_kiosk', now()) RETURNING id`,
      [registrationId],
    );
    const soloRegistrationId = registration.rows[0].id;
    const onlyPerformance = await app.inject({ method: 'POST', url: '/api/performances', headers: { authorization: 'Bearer performance-owner' }, payload: { registration_id: soloRegistrationId, name: 'Only set', status: 'registered' } });
    expect(onlyPerformance.statusCode).toBe(201);

    const deletedLast = await app.inject({ method: 'DELETE', url: `/api/performances/${onlyPerformance.json().id}`, headers: { authorization: 'Bearer performance-owner' } });
    expect(deletedLast.statusCode).toBe(204);
    const registrationGone = await app.inject({ method: 'GET', url: `/api/registrations/${soloRegistrationId}/performances` });
    expect(registrationGone.statusCode).toBe(404);
  });

  it('rejects management by a non-owner', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer performance-outsider' },
      payload: { registration_id: registrationId, name: 'Unauthorized' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('automatically timestamps each lifecycle transition and lets a performer perform again in a new entry', async () => {
    // A registration can only have one active performance at a time, so whatever's still active
    // on `registrationId` from an earlier test has to reach a terminal state first.
    const priorPerformances = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances` });
    for (const row of priorPerformances.json() as Array<{ id: string; status: string }>) {
      if (!['performed', 'no_show', 'cancelled'].includes(row.status)) {
        await app.inject({
          method: 'PUT',
          url: `/api/performances/${row.id}`,
          headers: { authorization: 'Bearer performance-owner' },
          payload: { status: 'no_show' },
        });
      }
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer performance-owner' },
      payload: { registration_id: registrationId, name: 'Second song', status: 'registered' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().checked_in_at).toBeNull();

    const checkedIn = await app.inject({
      method: 'PUT',
      url: `/api/performances/${id}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'present' },
    });
    expect(checkedIn.statusCode).toBe(200);
    expect(checkedIn.json().checked_in_at).not.toBeNull();
    expect(checkedIn.json().scheduled_at).toBeNull();

    const scheduled = await app.inject({
      method: 'PUT',
      url: `/api/performances/${id}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'scheduled' },
    });
    expect(scheduled.json().scheduled_at).not.toBeNull();
    expect(typeof scheduled.json().sequence).toBe('number');

    const performing = await app.inject({
      method: 'PUT',
      url: `/api/performances/${id}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'performing' },
    });
    expect(performing.json().started_at).not.toBeNull();

    const finished = await app.inject({
      method: 'PUT',
      url: `/api/performances/${id}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'performed' },
    });
    expect(finished.json().finished_at).not.toBeNull();

    // Performing again is a brand-new entry (per decisions.md), starting at "present" since the
    // performer is already physically at the venue; it does not reuse or reset the prior row.
    const again = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer performance-owner' },
      payload: { registration_id: registrationId, name: 'Second song', sequence: 2, status: 'present' },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().status).toBe('present');
    expect(again.json().checked_in_at).not.toBeNull();
    expect(again.json().id).not.toBe(id);
  });

  it('auto-assigns an increasing, event-wide sequence number when a performance is scheduled, without the client sending one', async () => {
    const auth = { authorization: 'Bearer performance-owner' };
    // A registration can only have one active performance at a time, so whatever's still active
    // on `registrationId` from the previous test has to reach a terminal state first.
    const priorPerformances = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances` });
    for (const row of priorPerformances.json() as Array<{ id: string; status: string }>) {
      if (!['performed', 'no_show', 'cancelled'].includes(row.status)) {
        await app.inject({ method: 'PUT', url: `/api/performances/${row.id}`, headers: auth, payload: { status: 'no_show' } });
      }
    }
    // Two separate registrations, since a single registration can't hold two simultaneously
    // active performances — sequencing itself is scoped per-column across the whole event, not
    // per-registration, so this is equivalent to the original single-registration test intent.
    const secondRegistration = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id, performer_name, submission_channel, organizer_supervised, verification_method, email_verified_at)
       VALUES ((SELECT event_id FROM registrations WHERE id = $1), 'Queue Performer Two', 'kiosk', true, 'organizer_kiosk', now()) RETURNING id`,
      [registrationId],
    );
    const registrationTwoId = secondRegistration.rows[0].id;
    const createOne = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: auth,
      payload: { registration_id: registrationId, name: 'Queue performer one', status: 'present' },
    });
    const createTwo = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: auth,
      payload: { registration_id: registrationTwoId, name: 'Queue performer two', status: 'present' },
    });
    const idOne = createOne.json().id as string;
    const idTwo = createTwo.json().id as string;

    // Neither PUT sends a `sequence` field — the server must assign the next event-wide slot itself
    // so every organizer viewing the roster agrees on running order.
    const scheduledOne = await app.inject({
      method: 'PUT',
      url: `/api/performances/${idOne}`,
      headers: auth,
      payload: { status: 'scheduled' },
    });
    const scheduledTwo = await app.inject({
      method: 'PUT',
      url: `/api/performances/${idTwo}`,
      headers: auth,
      payload: { status: 'scheduled' },
    });
    expect(scheduledOne.statusCode).toBe(200);
    expect(scheduledTwo.statusCode).toBe(200);
    expect(scheduledTwo.json().sequence).toBeGreaterThan(scheduledOne.json().sequence);

    // The sequence assigned at "scheduled" time is left untouched by later status-only updates, so
    // it survives as the eventual performance order too.
    const performing = await app.inject({
      method: 'PUT',
      url: `/api/performances/${idOne}`,
      headers: auth,
      payload: { status: 'performing' },
    });
    expect(performing.json().sequence).toBe(scheduledOne.json().sequence);
  });
});
