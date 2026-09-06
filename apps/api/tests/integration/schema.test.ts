import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('core database schema', () => {
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(database);
  }, 30_000);

  it('enables PostGIS and creates the Phase 1 tables', async () => {
    const result = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto') ORDER BY extname",
    );
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('accounts', 'profiles', 'handles', 'open_mics', 'events', 'registrations', 'performances') ORDER BY tablename",
    );

    expect(result.rows.map((row) => row.extname)).toEqual(['pgcrypto', 'postgis']);
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'accounts',
      'events',
      'handles',
      'open_mics',
      'performances',
      'profiles',
      'registrations',
    ]);
  });

  it('maintains canonical handle casing and rejects case-insensitive duplicates', async () => {
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('integration-account', 'integration@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Integration Profile', 'performer') RETURNING id",
      [account.rows[0].id],
    );

    await pool.query(
      "INSERT INTO handles (handle, entity_type, profile_id, status) VALUES ('Integration-Handle', 'profile', $1, 'current')",
      [profile.rows[0].id],
    );
    const cached = await pool.query<{ current_handle: string }>(
      'SELECT current_handle FROM profiles WHERE id = $1',
      [profile.rows[0].id],
    );

    expect(cached.rows[0].current_handle).toBe('Integration-Handle');

    await pool.query("UPDATE handles SET handle = 'INTEGRATION-HANDLE' WHERE handle = 'Integration-Handle'");
    const recased = await pool.query<{ current_handle: string }>(
      'SELECT current_handle FROM profiles WHERE id = $1',
      [profile.rows[0].id],
    );
    expect(recased.rows[0].current_handle).toBe('INTEGRATION-HANDLE');

    await expect(
      pool.query("INSERT INTO handles (handle, status) VALUES ('integration-handle', 'available')"),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('generates a PostGIS location from open-mic coordinates', async () => {
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('location-account', 'location@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Location Organizer', 'organizer') RETURNING id",
      [account.rows[0].id],
    );
    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics
        (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone, lat, lng)
       VALUES ($1, 'Location Open Mic', ARRAY['singing'], 'Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin', 53.3498, -6.2603)
       RETURNING id`,
      [profile.rows[0].id],
    );
    const location = await pool.query<{ srid: number; point: string }>(
      'SELECT ST_SRID(location) AS srid, ST_AsText(location::geometry) AS point FROM open_mics WHERE id = $1',
      [openMic.rows[0].id],
    );

    expect(location.rows[0]).toEqual({ srid: 4326, point: 'POINT(-6.2603 53.3498)' });
  });

  it('prevents duplicate verified guest registrations for the same event and email, but allows unverified duplicates', async () => {
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('registration-account', 'registration@example.test') RETURNING id",
    );
    const profile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Registration Organizer', 'organizer') RETURNING id",
      [account.rows[0].id],
    );
    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics
        (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone)
       VALUES ($1, 'Registration Open Mic', ARRAY['singing'], 'Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin')
       RETURNING id`,
      [profile.rows[0].id],
    );
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events
        (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country)
       VALUES ($1, 'Registration Event', now() + interval '7 days', 'Europe/Dublin', 'Venue', '1 Test Street', 'Dublin', 'IE')
       RETURNING id`,
      [openMic.rows[0].id],
    );

    const insertRegistration = (verified: boolean) =>
      pool.query(
        `INSERT INTO registrations (event_id, performer_name, contact_email, email_verified_at, verification_method)
         VALUES ($1, 'Guest Performer', 'duplicate@example.test', ${verified ? 'now()' : 'NULL'}, ${verified ? "'email'" : 'NULL'})`,
        [event.rows[0].id],
      );

    await insertRegistration(false);
    await insertRegistration(false);

    await insertRegistration(true);
    await expect(insertRegistration(true)).rejects.toMatchObject({ code: '23505' });
  });
});