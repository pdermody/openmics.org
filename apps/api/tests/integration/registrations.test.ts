import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { createMemoryEmailAdapter } from '../../src/email/index.js';
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
  let emailAdapter: ReturnType<typeof createMemoryEmailAdapter>;

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
    emailAdapter = createMemoryEmailAdapter();
    app = buildApp({ db: pool, logger: false, emailAdapter, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000, appBaseUrl: 'http://localhost:5173' } });
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

    const confirmationEmail = emailAdapter.sent.find((message) => message.to === 'guest@example.test');
    expect(confirmationEmail).toBeDefined();
    expect(confirmationEmail?.subject).toContain('Registration Event');
    const confirmUrl = new URL(confirmationEmail!.text.match(/https?:\/\/\S+/)![0]);
    expect(confirmUrl.pathname).toMatch(/\/events\/.+\/register/);
    expect(confirmUrl.searchParams.get('token')).toBeTruthy();
    expect(confirmUrl.searchParams.get('verify')).toBeTruthy();

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

    // Every registration auto-creates a first performance slot; kiosk sign-ups start "present"
    // (the organizer's physical presence already substitutes for check-in), everyone else starts
    // "registered" and is checked in at the door later.
    const roster = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(roster.statusCode).toBe(200);
    const rosterRows = roster.json() as Array<{ id: string; performer_name: string; performances: Array<{ status: string }> }>;
    const guestRow = rosterRows.find((row) => row.performer_name === 'Guest Performer');
    expect(guestRow?.performances).toHaveLength(1);
    expect(guestRow?.performances[0].status).toBe('registered');
    const kioskRow = rosterRows.find((row) => row.performer_name === 'Walk-in Performer');
    expect(kioskRow?.performances).toHaveLength(1);
    expect(kioskRow?.performances[0].status).toBe('present');
  });

  it('lets the organizer reopen registrations after closing them', async () => {
    const closed = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer registration-owner' },
      payload: { registrations_closed_at: new Date().toISOString() },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().registrations_closed_at).toBeTruthy();

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Blocked Performer',
        contact_email: 'blocked-performer@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('REGISTRATIONS_CLOSED');

    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer registration-claimant' },
      payload: { registrations_closed_at: null },
    });
    expect(forbidden.statusCode).toBe(403);

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}`,
      headers: { authorization: 'Bearer registration-owner' },
      payload: { registrations_closed_at: null },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().registrations_closed_at).toBeNull();

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Reopened Performer',
        contact_email: 'reopened-performer@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('resolves the magic edit link with the originally submitted song names', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Song Performer',
        contact_email: 'song-performer@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
        song_names: ['Wonderwall', 'Creep'],
      },
    });
    expect(guest.statusCode).toBe(201);
    expect(guest.json().song_names).toEqual(['Wonderwall', 'Creep']);

    const confirmationEmail = emailAdapter.sent.find((message) => message.to === 'song-performer@example.test');
    const confirmUrl = new URL(confirmationEmail!.text.match(/https?:\/\/\S+/)![0]);
    const editToken = confirmUrl.searchParams.get('token');

    const edit = await app.inject({ method: 'GET', url: `/api/registrations/edit?token=${editToken}` });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().song_names).toEqual(['Wonderwall', 'Creep']);
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

  it('lists a profile\'s own registrations across events, and forbids checking another account\'s profile', async () => {
    const performerRegistration = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-claimant' },
      payload: {
        profile_id: claimantProfileId,
        performer_name: 'Claimed Performer',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(performerRegistration.statusCode).toBe(201);

    const mine = await app.inject({
      method: 'GET',
      url: `/api/me/registrations?profile=${claimantProfileId}`,
      headers: { authorization: 'Bearer registration-claimant' },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().some((registration: { event_id: string }) => registration.event_id === eventId)).toBe(true);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/me/registrations?profile=${claimantProfileId}`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(forbidden.statusCode).toBe(403);
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

  it('includes each registration\'s performances in the organizer roster listing, and rejects a non-owner', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Roster Performer',
        contact_email: 'roster-performer@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const registrationId = created.json().id as string;

    // A registration can only have one active performance at a time, so the auto-created first
    // slot has to be moved to a terminal state (no_show, here — same override available from any
    // status) before a second one can be added below.
    const initialPerformances = await app.inject({ method: 'GET', url: `/api/registrations/${registrationId}/performances`, headers: { authorization: 'Bearer registration-owner' } });
    const initialPerformanceId = initialPerformances.json()[0].id as string;
    const noShow = await app.inject({
      method: 'PUT',
      url: `/api/performances/${initialPerformanceId}`,
      headers: { authorization: 'Bearer registration-owner' },
      payload: { status: 'no_show' },
    });
    expect(noShow.statusCode).toBe(200);

    const performance = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer registration-owner' },
      payload: { registration_id: registrationId, name: 'Roster Performer', activity: 'singing', sequence: 3 },
    });
    expect(performance.statusCode).toBe(201);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-claimant' },
    });
    expect(forbidden.statusCode).toBe(403);

    const roster = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(roster.statusCode).toBe(200);
    const rosterRow = (roster.json() as Array<{ id: string; performances: Array<{ id: string; sequence: number; activity: string | null; status: string; notes: string | null }> }>).find(
      (row) => row.id === registrationId,
    );
    // Registration creation auto-adds a first "registered" performance slot, so this row should
    // now have that default slot (moved to no_show above) plus the one just added explicitly.
    expect(rosterRow?.performances).toHaveLength(2);
    expect(rosterRow?.performances.find((performance) => performance.sequence === 1)).toMatchObject({ status: 'no_show' });
    expect(rosterRow?.performances.find((performance) => performance.sequence === 3)).toMatchObject({ activity: 'singing' });
  });

  it('lets the organizer delete a registration, and hides it from the roster afterwards', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/registrations`,
      payload: {
        performer_name: 'Deletable Performer',
        contact_email: 'deletable-performer@example.test',
        submission_channel: 'organic',
        organizer_supervised: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const registrationId = created.json().id as string;

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/registrations/${registrationId}`,
      headers: { authorization: 'Bearer registration-claimant' },
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/registrations/${registrationId}`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(deleted.statusCode).toBe(204);

    const roster = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/registrations`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(roster.statusCode).toBe(200);
    expect((roster.json() as Array<{ id: string }>).some((row) => row.id === registrationId)).toBe(false);

    const secondDelete = await app.inject({
      method: 'DELETE',
      url: `/api/registrations/${registrationId}`,
      headers: { authorization: 'Bearer registration-owner' },
    });
    expect(secondDelete.statusCode).toBe(404);
  });
});
