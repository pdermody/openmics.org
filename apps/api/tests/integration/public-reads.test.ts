import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('public read routes (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let publicProfileId: string;
  let privateProfileId: string;
  let activeOpenMicId: string;
  let draftOpenMicId: string;
  let upcomingEventId: string;
  let closedEventId: string;
  let ownerAccountId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id, email) VALUES ('public-reads-owner', 'public-reads@example.test') RETURNING id",
    );
    const publicProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, visibility) VALUES ($1, 'Visible Profile', 'performer', 'public') RETURNING id",
      [account.rows[0].id],
    );
    ownerAccountId = account.rows[0].id;
    publicProfileId = publicProfile.rows[0].id;
    const privateProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, visibility) VALUES ($1, 'Hidden Profile', 'performer', 'private') RETURNING id",
      [account.rows[0].id],
    );
    privateProfileId = privateProfile.rows[0].id;
    const active = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, activities, venue_name, address_line1, city, country, lat, lng, time_zone, registration_mode, status)
       VALUES ($1, 'Active Series', ARRAY['singing'], 'Venue', '1 Street', 'Dublin', 'IE', 53.3498, -6.2603, 'Europe/Dublin', 'pre_only', 'active') RETURNING id`,
      [publicProfileId],
    );
    activeOpenMicId = active.rows[0].id;
    await pool.query(
      "INSERT INTO handles (handle, entity_type, open_mic_id, status) VALUES ('Active-Series', 'open_mic', $1, 'current')",
      [activeOpenMicId],
    );
    await pool.query("UPDATE open_mics SET current_handle = 'Active-Series' WHERE id = $1", [activeOpenMicId]);
    const draft = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id, name, activities, venue_name, address_line1, city, country, time_zone, status)
       VALUES ($1, 'Draft Series', ARRAY['singing'], 'Venue', '1 Street', 'Dublin', 'IE', 'Europe/Dublin', 'draft') RETURNING id`,
      [publicProfileId],
    );
    draftOpenMicId = draft.rows[0].id;
    const upcoming = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, lat, lng)
       VALUES ($1, 'Upcoming Event', now() + interval '2 days', now() + interval '2 days 3 hours', 'published', 'Europe/Dublin', 'Venue', '1 Street', 'Dublin', 'IE', 53.3498, -6.2603) RETURNING id`,
      [activeOpenMicId],
    );
    upcomingEventId = upcoming.rows[0].id;
    const closed = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, registrations_closed_at, time_zone, venue_name, address_line1, city, country)
      VALUES ($1, 'Closed Event', now() + interval '1 day', now() + interval '1 day 3 hours', 'published', now() - interval '1 hour', 'Europe/Dublin', 'Venue', '1 Street', 'Dublin', 'IE') RETURNING id`,
      [activeOpenMicId],
    );
    closedEventId = closed.rows[0].id;
    app = buildApp({ db: pool, logger: false, authVerifier: async (token) => token === 'owner'
      ? { accountId: ownerAccountId, isPlatformAdmin: false } : null,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(database);
  }, 30_000);

  it('lists public profiles and hides private profile details', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/profiles?page=1&page_size=10' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(publicProfileId);
    expect(list.json().items.map((item: { id: string }) => item.id)).not.toContain(privateProfileId);

    const detail = await app.inject({ method: 'GET', url: `/api/profiles/${privateProfileId}` });
    expect(detail.statusCode).toBe(404);
  });

  it('lists active open mics and excludes draft series', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/open-mics?page_size=10' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(activeOpenMicId);
    expect(list.json().items.map((item: { id: string }) => item.id)).not.toContain(draftOpenMicId);
  });

  it('returns upcoming events and explains a closed next event before the later registrable event', async () => {
    const upcoming = await app.inject({ method: 'GET', url: '/api/events/upcoming?limit=10' });
    expect(upcoming.statusCode).toBe(200);
    expect(upcoming.json().map((item: { id: string }) => item.id)).toContain(upcomingEventId);

    const next = await app.inject({ method: 'GET', url: `/api/open-mics/${activeOpenMicId}/next-event` });
    expect(next.statusCode).toBe(200);
    expect(next.json().current_event).toBeNull();
    expect(next.json().current_registration_open).toBe(false);
    expect(next.json().next_event.id).toBe(closedEventId);
    expect(next.json().next_registration_event.id).toBe(upcomingEventId);

    const detail = await app.inject({ method: 'GET', url: `/api/events/${upcomingEventId}` });
    expect(detail.statusCode).toBe(200);
  });

  it('applies PostGIS near and radius filters', async () => {
    const openMics = await app.inject({ method: 'GET', url: '/api/open-mics?near=53.3498,-6.2603&radius_km=1' });
    expect(openMics.statusCode).toBe(200);
    expect(openMics.json().items.map((item: { id: string }) => item.id)).toContain(activeOpenMicId);

    const events = await app.inject({ method: 'GET', url: '/api/events/upcoming?near=53.3498,-6.2603&radius_km=1' });
    expect(events.statusCode).toBe(200);
    expect(events.json().map((item: { id: string }) => item.id)).toContain(upcomingEventId);
  });

  it('serves the SPA entry point for public browser routes', async () => {
    const eventPage = await app.inject({ method: 'GET', url: `/events/${upcomingEventId}/register` });
    expect(eventPage.statusCode).toBe(200);
    expect(eventPage.headers['content-type']).toContain('text/html');
    expect(eventPage.body).toContain('<div id="root"></div>');

    const seriesPage = await app.inject({ method: 'GET', url: `/open-mics/${activeOpenMicId}/register` });
    expect(seriesPage.statusCode).toBe(200);
    expect(seriesPage.body).toBe(eventPage.body);

    const vanityPage = await app.inject({ method: 'GET', url: '/@Active-Series/register' });
    expect(vanityPage.statusCode).toBe(200);
    expect(vanityPage.body).toBe(eventPage.body);
  });

  it('public details exclude private notes, contact and numerical attendance even for owners', async () => {
    await pool.query("UPDATE events SET notes = 'Private notes', public_information = 'Public event information', capacity = 40, lat = 0, lng = 0 WHERE id = $1", [upcomingEventId]);
    await pool.query("UPDATE open_mics SET contact_email = 'private@example.test', public_information = 'Public series information', entry_fee_note = 'Pay what you can' WHERE id = $1", [activeOpenMicId]);
    for (const headers of [{}, { authorization: 'Bearer owner' }]) {
      const event = await app.inject({ url: `/api/events/${upcomingEventId}/public-details`, headers });
      expect(event.statusCode).toBe(200);
      expect(event.json()).toMatchObject({ public_information: 'Public event information', entry_fee_note: 'Pay what you can', lat: 0, lng: 0 });
      for (const key of ['notes', 'capacity', 'audience_guest_count']) expect(event.json()).not.toHaveProperty(key);
      const series = await app.inject({ url: `/api/open-mics/${activeOpenMicId}/public-details`, headers });
      expect(series.json()).not.toHaveProperty('contact_email');
      expect((await app.inject({ url: `/api/open-mics/${draftOpenMicId}/public-details`, headers })).statusCode).toBe(404);
    }
    const management = await app.inject({ url: `/api/events/${upcomingEventId}`, headers: { authorization: 'Bearer owner' } });
    expect(management.json().notes).toBe('Private notes');
    const upcoming = await app.inject({ url: '/api/events/upcoming' });
    expect(upcoming.json().every((row: Record<string, unknown>) => !('notes' in row) && !('capacity' in row))).toBe(true);
  });

  it('canonicalizes details links and rejects expired handles and mismatched events', async () => {
    await pool.query(
      `INSERT INTO handles (handle, entity_type, open_mic_id, status, redirects_to_handle, redirect_expires_at)
       VALUES ('Previous-Series', 'open_mic', $1, 'redirect', 'Active-Series', now() + interval '1 day'),
              ('Expired-Series', 'open_mic', $1, 'redirect', 'Active-Series', now() - interval '1 day')`,
      [activeOpenMicId],
    );
    const event = await pool.query<{ public_code: string }>('SELECT public_code FROM events WHERE id = $1', [upcomingEventId]);
    for (const path of [
      `/events/${upcomingEventId}/details`,
      `/events/${event.rows[0].public_code}/details`,
      `/@active-series/events/${upcomingEventId}/details`,
      `/@Previous-Series/events/${upcomingEventId}/details`,
    ]) {
      const response = await app.inject({ url: `${path}?tab=photos` });
      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe(`/@Active-Series/events/${upcomingEventId}/details?tab=photos`);
    }
    expect((await app.inject({ url: `/open-mics/${activeOpenMicId}/details` })).headers.location).toBe('/@Active-Series/details');
    expect((await app.inject({ url: `/@Active-Series/events/${upcomingEventId}/details` })).statusCode).toBe(200);
    expect((await app.inject({ url: '/@Expired-Series/details' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/@Active-Series/events/unknown/details' })).statusCode).toBe(404);
    const otherEvent = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country)
       SELECT $1, 'Other event', starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country
       FROM events WHERE id = $2 RETURNING id`, [draftOpenMicId, upcomingEventId],
    );
    expect((await app.inject({ url: `/@Active-Series/events/${otherEvent.rows[0].id}/details` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/open-mics/${draftOpenMicId}/public-details`, headers: { authorization: 'Bearer owner' } })).statusCode).toBe(404);
  });

  it('calculates attendance at exact thresholds without counting pending, deleted or duplicate sets', async () => {
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, capacity, audience_guest_count)
       SELECT open_mic_id, 'Attendance', starts_at, ends_at, status, time_zone, venue_name, address_line1, city, country, 40, 9 FROM events WHERE id = $1 RETURNING id`,
      [upcomingEventId],
    );
    const id = event.rows[0].id;
    const registrations = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id, performer_name, contact_email, email_verified_at, verification_method)
       SELECT $1, 'Performer ' || n, 'attendance-' || n || '@example.test', now(), 'email' FROM generate_series(1, 30) n RETURNING id`, [id],
    );
    await pool.query("INSERT INTO performances (registration_id, name, status) VALUES ($1, 'Cancelled set', 'cancelled'), ($1, 'Active set', 'registered')", [registrations.rows[0].id]);
    await pool.query("INSERT INTO registrations (event_id, performer_name, contact_email) VALUES ($1, 'Pending', 'pending-attendance@example.test')", [id]);
    await pool.query(
      `INSERT INTO registrations (event_id, performer_name, contact_email, email_verified_at, verification_method, deleted_at)
       VALUES ($1, 'Deleted performer', 'deleted-attendance@example.test', now(), 'email', now())`, [id],
    );
    await pool.query('UPDATE registrations SET profile_id = $1 WHERE id = $2', [privateProfileId, registrations.rows[1].id]);
    const status = async () => (await app.inject({ url: `/api/events/${id}/attendance-status` })).json();
    expect(await status()).toEqual({ status: 'below_limit' });
    await pool.query('UPDATE events SET audience_guest_count = 10 WHERE id = $1', [id]);
    expect(await status()).toEqual({ status: 'at_capacity' });
    await pool.query("UPDATE performances SET status = 'no_show' WHERE registration_id = $1", [registrations.rows[0].id]);
    expect(await status()).toEqual({ status: 'below_limit' });
    await pool.query('UPDATE events SET audience_guest_count = NULL WHERE id = $1', [id]);
    expect(await status()).toEqual({ status: 'incomplete' });
    await pool.query('UPDATE events SET capacity = 29 WHERE id = $1', [id]);
    expect(await status()).toEqual({ status: 'at_capacity' });
    expect((await app.inject({ url: `/api/events/${id}/attendance` })).statusCode).toBe(401);
    const owner = await app.inject({ url: `/api/events/${id}/attendance`, headers: { authorization: 'Bearer owner' } });
    expect(owner.json().confirmed_performers).toBe(29);
    const invalid = await app.inject({ method: 'PATCH', url: `/api/events/${id}`, headers: { authorization: 'Bearer owner' }, payload: { audience_guest_count: -1 } });
    expect(invalid.statusCode).toBe(400);
    await pool.query('UPDATE events SET ends_at = NULL WHERE id = $1', [id]);
    const recorded = await app.inject({ method: 'PATCH', url: `/api/events/${id}`, headers: { authorization: 'Bearer owner' }, payload: { audience_guest_count: 0 } });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json().audience_guest_count).toBe(0);
    await pool.query("UPDATE performances SET deleted_at = now() WHERE registration_id = $1", [registrations.rows[0].id]);
    const restored = await app.inject({ url: `/api/events/${id}/attendance`, headers: { authorization: 'Bearer owner' } });
    expect(restored.json().confirmed_performers).toBe(30);
  });

  it('creates and clears public-information snapshots without copying private notes or attendance', async () => {
    await pool.query("UPDATE open_mics SET public_information = 'Series instructions' WHERE id = $1", [activeOpenMicId]);
    const payload = { title: 'Snapshot event', starts_at: '2027-01-01T19:00:00Z', ends_at: '2027-01-01T22:00:00Z', time_zone: 'Europe/Dublin', capacity: 40 };
    const created = await app.inject({ method: 'POST', url: `/api/open-mics/${activeOpenMicId}/events`, headers: { authorization: 'Bearer owner' }, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ public_information: 'Series instructions', audience_guest_count: 0, notes: null });
    await pool.query("UPDATE open_mics SET public_information = 'Changed instructions' WHERE id = $1", [activeOpenMicId]);
    const unchanged = await app.inject({ url: `/api/events/${created.json().id}`, headers: { authorization: 'Bearer owner' } });
    expect(unchanged.json().public_information).toBe('Series instructions');
    const cleared = await app.inject({ method: 'PATCH', url: `/api/events/${created.json().id}`, headers: { authorization: 'Bearer owner' }, payload: { public_information: null } });
    expect(cleared.json().public_information).toBeNull();
    const explicitEmpty = await app.inject({ method: 'POST', url: `/api/open-mics/${activeOpenMicId}/events`, headers: { authorization: 'Bearer owner' }, payload: { ...payload, public_information: '' } });
    expect(explicitEmpty.json().public_information).toBe('');
  });
});
