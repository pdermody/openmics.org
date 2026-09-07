import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('registration routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let ownerAccountId: string;
  let ownerProfileId: string;
  let eventId: string;
  let claimantAccountId: string;
  let claimantProfileId: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('registration-owner', 'owner@example.test') RETURNING id",
    );
    ownerAccountId = owner.rows[0].id;
    const ownerProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Owner', 'organizer') RETURNING id",
      [ownerAccountId],
    );
    ownerProfileId = ownerProfile.rows[0].id;

    const claimant = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('registration-claimant', 'guest@example.test') RETURNING id",
    );
    claimantAccountId = claimant.rows[0].id;
    const claimantProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind) VALUES ($1, 'Claimed Performer', 'performer') RETURNING id",
      [claimantAccountId],
    );
    claimantProfileId = claimantProfile.rows[0].id;

    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, venue_name, address_line1, city, country, time_zone, activities, age_policy)
       VALUES ($1, 'Registration Open Mic', 'Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin', ARRAY['singing'], 'both')
       RETURNING id`,
      [ownerProfileId],
    );
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country)
       VALUES ($1, 'Registration Event', now() + interval '7 days', 'Europe/Dublin', 'Venue', '1 Test Street', 'Dublin', 'IE')
       RETURNING id`,
      [openMic.rows[0].id],
    );
    eventId = event.rows[0].id;
    app = buildApp({ db: pool, logger: false, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(database);
  }, 30_000);

  it('creates a pending guest registration and verifies a kiosk registration', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Guest Performer',
        contact_email: 'guest@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(guest.statusCode).toBe(201);
    expect(guest.json().visibility_state).toBe('pending');

    const kiosk = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-owner' },
      payload: {
        performer_name: 'Walk-in Performer',
        submission_channel: 'kiosk',
        organizer_supervised: true,
      },
    });
    expect(kiosk.statusCode).toBe(201);
    expect(kiosk.json().visibility_state).toBe('valid');
    expect(kiosk.json().verification_method).toBe('organizer_kiosk');
  });

  it('requires an authenticated organizer to select a performer profile for self-registration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-owner' },
      payload: {
        performer_name: 'Organizer Self Registration',
        contact_email: 'owner@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe('Select an account-owned performer profile to register');
  });

  it.each(['on_night_only', 'external'])('rejects standard registrations when the parent open mic uses %s mode', async (registrationMode) => {
    const openMic = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, venue_name, address_line1, city, country, time_zone, activities, age_policy, registration_mode, external_registration_url)
       VALUES ($1, 'Mode Guard Open Mic', 'Venue', '1 Test Street', 'Dublin', 'IE', 'Europe/Dublin', ARRAY['singing'], 'both', $2, $3)
       RETURNING id`,
      [ownerProfileId, registrationMode, registrationMode === 'external' ? 'https://example.test/register' : null],
    );
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country)
       VALUES ($1, 'Mode Guard Event', now() + interval '9 days', 'Europe/Dublin', 'Venue', '1 Test Street', 'Dublin', 'IE')
       RETURNING id`,
      [openMic.rows[0].id],
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/events/${event.rows[0].id}/registrations`,
      payload: {
        performer_name: 'Blocked Performer',
        contact_email: `${registrationMode}@example.test`,
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('REGISTRATION_MODE_DISABLED');
  });

  it('rejects a second verified registration for the same event and email', async () => {
    await pool.query(
      "UPDATE registrations SET email_verified_at = now(), verification_method = 'email' WHERE contact_email = 'guest@example.test'",
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Duplicate Guest',
        contact_email: 'guest@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('DUPLICATE_REGISTRATION');
  });

  it('claims a verified guest registration and adopts an owned performer profile', async () => {
    const registration = await pool.query<{ id: string }>(
      "SELECT id FROM registrations WHERE contact_email = 'guest@example.test' LIMIT 1",
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/registrations/${registration.rows[0].id}/claim`,
      headers: { authorization: 'Bearer registration-claimant' },
      payload: { adopted_profile_id: claimantProfileId, sync_public_fields: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().claimed_by_account_id).toBe(claimantAccountId);
    expect(response.json().adopted_profile_id).toBe(claimantProfileId);
    expect(response.json().performer_name).toBe('Claimed Performer');
  });

  it('enforces event capacity atomically', async () => {
    const capacityEvent = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, time_zone, venue_name, address_line1, city, country, capacity)
       SELECT open_mic_id, 'Capacity Event', now() + interval '8 days', time_zone, venue_name, address_line1, city, country, 1
       FROM events WHERE id = $1 RETURNING id`,
      [eventId],
    );
    const payload = (name: string) => ({
      performer_name: name,
      contact_email: `${name.toLowerCase()}@example.test`,
      submission_channel: 'organic',
      organizer_supervised: false,
    });
    expect((await app.inject({ method: 'POST', url: `/api/events/${capacityEvent.rows[0].id}/registrations`, payload: payload('First') })).statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/api/events/${capacityEvent.rows[0].id}/registrations`, payload: payload('Second') });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CAPACITY_EXCEEDED');
  });
});
