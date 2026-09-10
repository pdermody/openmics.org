import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('events routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let organizerProfileId: string;
  let openMicId: string;

  const app = () =>
    buildApp({
      db: pool,
      logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    });

  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    title: 'Test Event',
    starts_at: '2026-12-15T19:00:00Z',
    time_zone: 'Europe/Dublin',
    ...overrides,
  });

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('events-owner', 'events-owner@example.test') RETURNING id",
    );
    const organizerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Owner Organizer', 'organizer') RETURNING id",
      [owner.rows[0].id],
    );
    organizerProfileId = organizerProfile.rows[0].id;

    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, venue_name, address_line1, city, country, time_zone, activities, age_policy, status)
       VALUES ($1, 'Test Open Mic', 'Test Venue', '1 Test St', 'Dublin', 'IE', 'Europe/Dublin', ARRAY['singing'], 'both', 'active')
       RETURNING id`,
      [organizerProfileId],
    );
    openMicId = openMic.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('creates an event for an owned open mic', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.title).toBe('Test Event');
    expect(body.starts_at).toBe('2026-12-15T19:00:00.000Z');
    expect(body.time_zone).toBe('Europe/Dublin');
    expect(body.open_mic_id).toBe(openMicId);
    await instance.close();
  });

  it('allows location snapshot override with all fields', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({
        venue_name: 'Alternate Venue',
        address_line1: '99 Other Street',
        city: 'Cork',
        country: 'IE',
        lat: 51.9,
        lng: -8.47,
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.venue_name).toBe('Alternate Venue');
    expect(body.city).toBe('Cork');
    await instance.close();
  });

  it('rejects partial location override', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({
        venue_name: 'Alternate Venue', // partial override
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await instance.close();
  });

  it('returns 404 for nonexistent open mic', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await instance.close();
  });

  it('enforces ownership: rejects creation by non-owner', async () => {
    const instance = app();

    // Create a different account/profile
    const other = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('events-other', 'events-other@example.test') RETURNING id",
    );
    const otherProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Other Organizer', 'organizer') RETURNING id",
      [other.rows[0].id],
    );

    const response = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-other' },
      payload: validPayload({ title: 'Hijacked Event' }),
    });

    expect(response.statusCode).toBe(403);
    await instance.close();
  });

  it('lists events for an open mic', async () => {
    const instance = app();

    // Create two events
    await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Event 1', starts_at: '2026-12-10T19:00:00Z' }),
    });

    await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Event 2', starts_at: '2026-12-20T19:00:00Z' }),
    });

    // List events
    const listResponse = await instance.inject({
      method: 'GET',
      url: `/api/open-mics/${openMicId}/events`,
    });

    expect(listResponse.statusCode).toBe(200);
    const events = listResponse.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
    await instance.close();
  });

  it('updates an event owned by the organizer', async () => {
    const instance = app();

    // Create an event
    const createResponse = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Original Title' }),
    });
    const eventId = createResponse.json().id;

    // Update it
    const updateResponse = await instance.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-owner' },
      payload: { notes: 'Updated notes' },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().notes).toBe('Updated notes');
    await instance.close();
  });

  it('rejects event update by non-owner', async () => {
    const instance = app();

    // Create an event
    const createResponse = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Protected Event' }),
    });
    const eventId = createResponse.json().id;

    // Create another account/profile
    const other = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('events-hijacker', 'events-hijacker@example.test') RETURNING id",
    );

    // Try to update as non-owner
    const updateResponse = await instance.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-hijacker' },
      payload: { notes: 'Hijacked' },
    });

    expect(updateResponse.statusCode).toBe(403);
    await instance.close();
  });

  it('resolves the parent open mic by its public_code for nested event routes', async () => {
    const instance = app();

    const openMicResponse = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}` });
    const openMicPublicCode = openMicResponse.json().public_code as string;
    expect(openMicPublicCode).toMatch(/^[A-Z0-9]{10}$/);

    const created = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicPublicCode}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Created Via Open Mic Public Code' }),
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;

    const listed = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicPublicCode}/events` });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ id: string }>).some((event) => event.id === eventId)).toBe(true);

    const fetched = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicPublicCode}/events/${eventId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(eventId);

    const updated = await instance.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-owner' },
      payload: { notes: 'Updated via open mic public code' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().notes).toBe('Updated via open mic public code');

    await instance.close();
  });

  it('soft-deletes an event, hides it from reads, rejects a non-owner delete, and allows the owner to recover it', async () => {
    const instance = app();

    const created = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Soft Delete Me' }),
    });
    const eventId = created.json().id as string;

    await pool.query(
      "INSERT INTO accounts (cognito_id, email) VALUES ('events-delete-other', 'events-delete-other@example.test') RETURNING id",
    );

    const forbiddenDelete = await instance.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-delete-other' },
    });
    expect(forbiddenDelete.statusCode).toBe(403);

    const deleted = await instance.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-owner' },
    });
    expect(deleted.statusCode).toBe(204);

    const getAfterDelete = await instance.inject({ method: 'GET', url: `/api/events/${eventId}` });
    expect(getAfterDelete.statusCode).toBe(404);

    const listAfterDelete = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}/events` });
    expect((listAfterDelete.json() as Array<{ id: string }>).some((event) => event.id === eventId)).toBe(false);

    const secondDelete = await instance.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer events-owner' },
    });
    expect(secondDelete.statusCode).toBe(404);

    const forbiddenRecover = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/recover`,
      headers: { authorization: 'Bearer events-delete-other' },
    });
    expect(forbiddenRecover.statusCode).toBe(403);

    const recovered = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/recover`,
      headers: { authorization: 'Bearer events-owner' },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().id).toBe(eventId);

    const getAfterRecover = await instance.inject({ method: 'GET', url: `/api/events/${eventId}` });
    expect(getAfterRecover.statusCode).toBe(200);

    const secondRecover = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/recover`,
      headers: { authorization: 'Bearer events-owner' },
    });
    expect(secondRecover.statusCode).toBe(404);

    await instance.close();
  });

  it('issues a roster stream token to the organizer and rejects non-owners', async () => {
    const instance = app();
    const created = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Stream Token Event' }),
    });
    const eventId = created.json().id as string;

    const forbidden = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/roster/stream-token`,
      headers: { authorization: 'Bearer events-hijacker' },
    });
    expect(forbidden.statusCode).toBe(403);

    const issued = await instance.inject({
      method: 'POST',
      url: `/api/events/${eventId}/roster/stream-token`,
      headers: { authorization: 'Bearer events-owner' },
    });
    expect(issued.statusCode).toBe(200);
    const body = issued.json() as { stream_token: string; expires_at: string };
    expect(typeof body.stream_token).toBe('string');
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());

    await instance.close();
  });

  it('rejects the roster stream without a valid stream token', async () => {
    const instance = app();
    const created = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/events`,
      headers: { authorization: 'Bearer events-owner' },
      payload: validPayload({ title: 'Stream Event' }),
    });
    const eventId = created.json().id as string;

    const missingToken = await instance.inject({ method: 'GET', url: `/api/events/${eventId}/roster/stream` });
    expect(missingToken.statusCode).toBe(403);

    const invalidToken = await instance.inject({
      method: 'GET',
      url: `/api/events/${eventId}/roster/stream?stream_token=not-a-real-token`,
    });
    expect(invalidToken.statusCode).toBe(403);

    await instance.close();
  });
});
