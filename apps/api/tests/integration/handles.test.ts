import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { checkHandleAvailability, resolveCurrentHandle } from '../../src/handles/repository.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('checkHandleAvailability', () => {
  let database: TestDatabase;
  let pool: Pool;
  let profileId: string;
  let openMicId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('handles-account', 'handles@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Handles Fixture', 'performer') RETURNING id",
      [account.rows[0].id],
    );
    profileId = profile.rows[0].id;

    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone)
       VALUES ($1, 'Handles Fixture Series', ARRAY['singing'], 'Venue', '1 Street', 'Dublin', 'IE', 'Europe/Dublin') RETURNING id`,
      [profileId],
    );
    openMicId = openMic.rows[0].id;

    await pool.query(
      "INSERT INTO handles (handle, entity_type, profile_id, status) VALUES ('taken-handle', 'profile', $1, 'current')",
      [profileId],
    );
    await pool.query(
      "INSERT INTO handles (handle, entity_type, open_mic_id, status) VALUES ('taken-open-mic-handle', 'open_mic', $1, 'current')",
      [openMicId],
    );
    await pool.query(
      `INSERT INTO handles (handle, entity_type, profile_id, status, redirects_to_handle, redirect_expires_at)
       VALUES ('redirected-handle', 'profile', $1, 'redirect', 'taken-handle', now() + interval '30 days')`,
      [profileId],
    );
    await pool.query(
      `INSERT INTO handles (handle, entity_type, profile_id, status, redirects_to_handle, quarantine_expires_at)
       VALUES ('quarantined-handle', 'profile', $1, 'quarantined', 'taken-handle', now() + interval '30 days')`,
      [profileId],
    );
    await pool.query("INSERT INTO handles (handle, status) VALUES ('reserved-handle', 'reserved')");
    await pool.query("INSERT INTO handles (handle, status) VALUES ('tombstoned-handle', 'tombstoned')");
    await pool.query("INSERT INTO handles (handle, status) VALUES ('available-handle', 'available')");
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('reports available for a handle with no row', async () => {
    expect(await checkHandleAvailability(pool, 'never-seen-handle')).toEqual({ available: true });
  });

  it('reports in_use for a current handle, case-insensitively', async () => {
    expect(await checkHandleAvailability(pool, 'TAKEN-HANDLE')).toEqual({ available: false, reason: 'in_use' });
  });

  it('reports the redirect, quarantined, reserved, and tombstoned states', async () => {
    expect(await checkHandleAvailability(pool, 'redirected-handle')).toEqual({ available: false, reason: 'redirect' });
    expect(await checkHandleAvailability(pool, 'quarantined-handle')).toEqual({
      available: false,
      reason: 'quarantined',
    });
    expect(await checkHandleAvailability(pool, 'reserved-handle')).toEqual({ available: false, reason: 'reserved' });
    expect(await checkHandleAvailability(pool, 'tombstoned-handle')).toEqual({
      available: false,
      reason: 'tombstoned',
    });
  });

  it('reports available for a row explicitly marked available', async () => {
    expect(await checkHandleAvailability(pool, 'available-handle')).toEqual({ available: true });
  });
});

describe('resolveCurrentHandle', () => {
  let database: TestDatabase;
  let pool: Pool;
  let profileId: string;
  let openMicId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('resolve-handles-account', 'resolve-handles@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Resolve Handles Fixture', 'organizer') RETURNING id",
      [account.rows[0].id],
    );
    profileId = profile.rows[0].id;

    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone)
       VALUES ($1, 'Resolve Handles Series', ARRAY['singing'], 'Venue', '1 Street', 'Dublin', 'IE', 'Europe/Dublin') RETURNING id`,
      [profileId],
    );
    openMicId = openMic.rows[0].id;

    await pool.query(
      "INSERT INTO handles (handle, entity_type, profile_id, status) VALUES ('resolve-profile-handle', 'profile', $1, 'current')",
      [profileId],
    );
    await pool.query(
      "INSERT INTO handles (handle, entity_type, open_mic_id, status) VALUES ('Resolve-Open-Mic-Handle', 'open_mic', $1, 'current')",
      [openMicId],
    );
    await pool.query(
      `INSERT INTO handles (handle, entity_type, open_mic_id, status, redirects_to_handle, redirect_expires_at)
       VALUES ('retired-open-mic-handle', 'open_mic', $1, 'redirect', 'Resolve-Open-Mic-Handle', now() + interval '30 days')`,
      [openMicId],
    );
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('resolves a current profile handle', async () => {
    expect(await resolveCurrentHandle(pool, 'resolve-profile-handle')).toEqual({
      entityType: 'profile',
      profileId,
      openMicId: null,
    });
  });

  it('resolves a current open-mic handle case-insensitively', async () => {
    expect(await resolveCurrentHandle(pool, 'resolve-open-mic-handle')).toEqual({
      entityType: 'open_mic',
      profileId: null,
      openMicId,
    });
  });

  it('returns null for a non-current (redirect) handle, an unknown handle, and a reserved handle', async () => {
    expect(await resolveCurrentHandle(pool, 'retired-open-mic-handle')).toBeNull();
    expect(await resolveCurrentHandle(pool, 'never-seen-handle')).toBeNull();
    await pool.query("INSERT INTO handles (handle, status) VALUES ('resolve-reserved-handle', 'reserved')");
    expect(await resolveCurrentHandle(pool, 'resolve-reserved-handle')).toBeNull();
  });
});
