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
    app = buildApp({ db: pool, logger: false, config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 } });
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
});
