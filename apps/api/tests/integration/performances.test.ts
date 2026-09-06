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

  it('allows the organizer to update and soft-delete a performance', async () => {
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/performances/${performanceId}`,
      headers: { authorization: 'Bearer performance-owner' },
      payload: { status: 'performed' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe('performed');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/performances/${performanceId}`,
      headers: { authorization: 'Bearer performance-owner' },
    });
    expect(deleted.statusCode).toBe(204);
    const listed = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances` });
    expect(listed.json()).toEqual([]);
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
});
