import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('open-mics routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let organizerProfileId: string;
  let performerProfileId: string;
  let otherOrganizerProfileId: string;

  const app = () =>
    buildApp({
      db: pool,
      logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    });

  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    name: 'Nighttown Galway',
    venue_name: 'Nighttown',
    address_line1: '1 Quay Street',
    city: 'Galway',
    country: 'IE',
    time_zone: 'Europe/Dublin',
    activities: ['singing'],
    ...overrides,
  });

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('open-mics-owner', 'open-mics-owner@example.test') RETURNING id",
    );
    const organizerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Owner Organizer', 'organizer') RETURNING id",
      [owner.rows[0].id],
    );
    organizerProfileId = organizerProfile.rows[0].id;

    const performerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Owner Performer', 'performer') RETURNING id",
      [owner.rows[0].id],
    );
    performerProfileId = performerProfile.rows[0].id;

    const other = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('open-mics-other', 'open-mics-other@example.test') RETURNING id",
    );
    const otherOrganizerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Other Organizer', 'organizer') RETURNING id",
      [other.rows[0].id],
    );
    otherOrganizerProfileId = otherOrganizerProfile.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('creates an open mic owned by the current organizer profile with an auto-generated handle', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': organizerProfileId },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.owner_profile_id).toBe(organizerProfileId);
    expect(body.current_handle).toBe('nighttown-galway');
    expect(body.age_policy).toBe('both');
    await instance.close();
  });

  it('rejects creation when X-Current-Profile references a performer profile', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': performerProfileId },
      payload: validPayload({ name: 'Should Not Be Created' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    await instance.close();
  });

  it('rejects creation when X-Current-Profile is owned by a different account', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': otherOrganizerProfileId },
      payload: validPayload({ name: 'Should Not Be Created Either' }),
    });

    expect(response.statusCode).toBe(403);
    await instance.close();
  });

  it('rejects external registration mode without a registration URL', async () => {
    const instance = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': organizerProfileId },
      payload: validPayload({ name: 'External Mode Missing URL', registration_mode: 'external' }),
    });

    expect(response.statusCode).toBe(400);
    await instance.close();
  });

  it('allows the owning account to update, but forbids other accounts', async () => {
    const instance = app();

    const created = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': organizerProfileId },
      payload: validPayload({ name: 'Update Ownership Test' }),
    });
    const openMicId = created.json().id as string;

    const forbidden = await instance.inject({
      method: 'PATCH',
      url: `/api/open-mics/${openMicId}`,
      headers: { authorization: 'Bearer open-mics-other' },
      payload: { description: 'Hijacked' },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await instance.inject({
      method: 'PATCH',
      url: `/api/open-mics/${openMicId}`,
      headers: { authorization: 'Bearer open-mics-owner' },
      payload: { description: 'Updated by owner' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().description).toBe('Updated by owner');

    await instance.close();
  });

  it('returns 404 for an open mic that does not exist', async () => {
    const instance = app();
    const response = await instance.inject({ method: 'GET', url: '/api/open-mics/00000000-0000-0000-0000-000000000000' });
    expect(response.statusCode).toBe(404);
    await instance.close();
  });
});
