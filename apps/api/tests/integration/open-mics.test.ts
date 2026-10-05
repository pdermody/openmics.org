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

  // The default plan allows ONE non-deleted series per organizer profile (decisions.md →
  // DEFAULT_PLAN), so every test that creates a series beyond the shared one gets its own
  // organizer profile (each profile has its own slot).
  async function freshOrganizerProfile(suffix: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind)
       VALUES ((SELECT id FROM accounts WHERE cognito_id = 'open-mics-owner'), $1, 'organizer') RETURNING id`,
      [`Owner Organizer ${suffix}`],
    );
    return result.rows[0].id;
  }

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
    const profileId = await freshOrganizerProfile('Update Ownership');

    const created = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': profileId },
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

  it('exposes a short public_code and allows reads/updates by that code as well as the UUID', async () => {
    const instance = app();
    const profileId = await freshOrganizerProfile('Public Code');

    const created = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': profileId },
      payload: validPayload({ name: 'Public Code Lookup Test' }),
    });
    const body = created.json();
    expect(body.public_code).toMatch(/^[A-Z0-9]{10}$/);
    await pool.query("UPDATE open_mics SET status='active' WHERE id=$1", [body.id]);

    const byCode = await instance.inject({ method: 'GET', url: `/api/open-mics/${body.public_code}` });
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json().id).toBe(body.id);

    const updateByCode = await instance.inject({
      method: 'PATCH',
      url: `/api/open-mics/${body.public_code}`,
      headers: { authorization: 'Bearer open-mics-owner' },
      payload: { description: 'Updated via public code' },
    });
    expect(updateByCode.statusCode).toBe(200);
    expect(updateByCode.json().description).toBe('Updated via public code');

    await instance.close();
  });

  it('GET /me/open-mics returns a newly-created (draft) series that the public directory hides', async () => {
    const instance = app();
    const profileId = await freshOrganizerProfile('Dashboard Draft');

    const created = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer open-mics-owner', 'x-current-profile': profileId },
      payload: validPayload({ name: 'My Dashboard Draft Series' }),
    });
    const body = created.json();
    expect(body.status).toBe('draft');

    // The public directory always excludes draft/ended series, even when filtered to this owner.
    const publicList = await instance.inject({
      method: 'GET',
      url: `/api/open-mics?owner_profile_id=${profileId}`,
    });
    expect(publicList.json().items.some((item: { id: string }) => item.id === body.id)).toBe(false);

    // The authenticated organizer-dashboard endpoint must still return it.
    const mine = await instance.inject({
      method: 'GET',
      url: `/api/me/open-mics?owner_profile_id=${profileId}`,
      headers: { authorization: 'Bearer open-mics-owner' },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items.some((item: { id: string }) => item.id === body.id)).toBe(true);

    await instance.close();
  });

  it('GET /me/open-mics requires owner_profile_id and forbids listing another account\'s profile', async () => {
    const instance = app();

    const missingParam = await instance.inject({
      method: 'GET',
      url: '/api/me/open-mics',
      headers: { authorization: 'Bearer open-mics-owner' },
    });
    expect(missingParam.statusCode).toBe(400);

    const forbidden = await instance.inject({
      method: 'GET',
      url: `/api/me/open-mics?owner_profile_id=${otherOrganizerProfileId}`,
      headers: { authorization: 'Bearer open-mics-owner' },
    });
    expect(forbidden.statusCode).toBe(403);

    await instance.close();
  });

  it('kiosk backup PIN: defaults to unconfigured, only the owner can set/verify it, and never exposes the stored PIN', async () => {
    const instance = app();
    const kioskProfileId = await freshOrganizerProfile('Kiosk Pin');
    const auth = { authorization: 'Bearer open-mics-owner', 'x-current-profile': kioskProfileId };
    const otherAuth = { authorization: 'Bearer open-mics-other' };

    const created = await instance.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: auth,
      payload: validPayload({ name: 'Kiosk Backup Pin Test' }),
    });
    const openMicId = created.json().id as string;

    const initialStatus = await instance.inject({
      method: 'GET',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: auth,
    });
    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json().configured).toBe(false);

    const unconfiguredReveal = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin/reveal`,
      headers: auth,
    });
    expect(unconfiguredReveal.statusCode).toBe(409);
    expect(unconfiguredReveal.json().error.code).toBe('KIOSK_BACKUP_PIN_NOT_CONFIGURED');

    const otherForbiddenGet = await instance.inject({
      method: 'GET',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: otherAuth,
    });
    expect(otherForbiddenGet.statusCode).toBe(403);

    const pin = '2468';
    const otherForbiddenSet = await instance.inject({
      method: 'PUT',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: otherAuth,
      payload: { pin },
    });
    expect(otherForbiddenSet.statusCode).toBe(403);

    const set = await instance.inject({
      method: 'PUT',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: auth,
      payload: { pin },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().configured).toBe(true);
    expect(set.json().pin).toBeUndefined();

    const revealed = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin/reveal`,
      headers: auth,
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().pin).toBe(pin);
    expect(revealed.headers['cache-control']).toBe('no-store');

    const otherForbiddenReveal = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin/reveal`,
      headers: otherAuth,
    });
    expect(otherForbiddenReveal.statusCode).toBe(403);

    const invalidPin = await instance.inject({
      method: 'PUT',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: auth,
      payload: { pin: '123' },
    });
    expect(invalidPin.statusCode).toBe(400);

    const nowConfigured = await instance.inject({
      method: 'GET',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin`,
      headers: auth,
    });
    expect(nowConfigured.json().configured).toBe(true);

    const wrongPin = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin/verify`,
      headers: auth,
      payload: { pin: '1357' },
    });
    expect(wrongPin.statusCode).toBe(200);
    expect(wrongPin.json().valid).toBe(false);

    const rightPin = await instance.inject({
      method: 'POST',
      url: `/api/open-mics/${openMicId}/kiosk-backup-pin/verify`,
      headers: auth,
      payload: { pin },
    });
    expect(rightPin.json().valid).toBe(true);

    // The stored PIN is never exposed via status or ordinary open-mic reads.
    expect(nowConfigured.json().pin).toBeUndefined();
    const publicRead = await instance.inject({ method: 'GET', url: `/api/open-mics/${openMicId}` });
    expect(publicRead.json().kiosk_backup_pin).toBeUndefined();

    await instance.close();
  });
});
