import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('public series browsing', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let seriesId: string;
  let ownerId: string;
  let organizerId: string;
  let performerId: string;
  let runningId: string;
  let boundaryId: string;
  let mediaId: string;
  const headers = { authorization: 'Bearer owner' };

  async function event(title: string, start: string, end: string, zone = 'UTC', status = 'published') {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO events (open_mic_id, title, starts_at, ends_at, time_zone, status, venue_name, address_line1, city, country)
       VALUES ($1,$2,$3,$4,$5,$6,'Venue','Street','Dublin','IE') RETURNING id`,
      [seriesId, title, start, end, zone, status],
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const account = await pool.query<{ id: string }>("INSERT INTO accounts (cognito_id,email) VALUES ('browse-owner','browse@example.test') RETURNING id");
    ownerId = account.rows[0].id;
    const organizer = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id,profile_name,profile_kind) VALUES ($1,'Organizer','organizer') RETURNING id", [ownerId]);
    organizerId = organizer.rows[0].id;
    const performer = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id,profile_name,profile_kind) VALUES ($1,'Performer','performer') RETURNING id", [ownerId]);
    performerId = performer.rows[0].id;
    const series = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id,name,venue_name,address_line1,city,country,time_zone,activities,status)
       VALUES ($1,'Browse series','Venue','Street','Dublin','IE','UTC',ARRAY['singing'],'active') RETURNING id`, [organizerId]);
    seriesId = series.rows[0].id;
    for (let day = 1; day <= 23; day++) {
      await event(`Future ${day}`, `2100-02-${String(day).padStart(2, '0')}T19:00:00Z`, `2100-02-${String(day).padStart(2, '0')}T22:00:00Z`);
    }
    boundaryId = await event('Local January', '2099-12-31T23:30:00Z', '2100-01-01T02:00:00Z', 'Europe/Paris');
    runningId = await event('Live night', new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 3600000).toISOString());
    await event('Old night', '2020-01-01T12:00:00Z', '2020-01-01T14:00:00Z');
    await event('DST night A', '2020-10-25T00:30:00Z', '2020-10-25T02:30:00Z', 'Europe/Dublin');
    await event('DST night B', '2020-10-25T01:30:00Z', '2020-10-25T03:30:00Z', 'Europe/Dublin');
    await event('Draft night', '2100-01-02T12:00:00Z', '2100-01-02T14:00:00Z', 'UTC', 'draft');
    const deleted = await event('Deleted night', '2100-01-03T12:00:00Z', '2100-01-03T14:00:00Z');
    await pool.query('UPDATE events SET deleted_at=now(), recovery_deadline=now()+interval \'30 days\' WHERE id=$1', [deleted]);
    const registration = await pool.query<{ id: string }>(
      `INSERT INTO registrations (event_id,performer_name,contact_email,submission_channel,organizer_supervised,media_consent,adopted_profile_id,claimed_by_account_id,claimed_at)
       VALUES ($1,'Performer','performer@example.test','organic',false,true,$2,$3,now()) RETURNING id`, [runningId, performerId, ownerId]);
    const media = await pool.query<{ id: string }>(
      `INSERT INTO media (media_type,event_id,registration_id,added_by_profile_id,source_url,width,height,caption)
       VALUES ('photo',$1,$2,$3,'https://media.example.test/photo.jpg',1200,800,'Public photo') RETURNING id`,
      [runningId, registration.rows[0].id, organizerId]);
    mediaId = media.rows[0].id;
    await pool.query('INSERT INTO open_mic_featured_media (open_mic_id,media_id,position) VALUES ($1,$2,0)', [seriesId, mediaId]);
    app = buildApp({
      db: pool, logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
      authVerifier: async (token) => token === 'owner' ? { accountId: ownerId, isPlatformAdmin: false } : null,
    });
    await app.ready();
  }, 120000);
  afterAll(async () => { await app?.close(); if (database) await stopTestDatabase(database); }, 30000);

  it('paginates 25 public upcoming events in stable 10/10/5 batches, even for owners', async () => {
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      const response = await app.inject({ url: `/api/open-mics/${seriesId}/public-events?page=${page}`, headers });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.pagination).toEqual({ page, page_size: 10, total: 25 });
      expect(body.items).toHaveLength(page === 3 ? 5 : 10);
      pages.push(...body.items);
    }
    expect(pages[0].id).toBe(runningId);
    expect(pages[0].phase).toBe('running');
    expect(new Set(pages.map((item) => item.id)).size).toBe(25);
    expect(pages.every((item) => item.status === 'published')).toBe(true);
    const dashboard = await app.inject({ url: `/api/open-mics/${seriesId}/events`, headers });
    expect(Array.isArray(dashboard.json())).toBe(true);
    expect(dashboard.json().some((item: { status: string }) => item.status === 'draft')).toBe(true);
  });

  it('filters full collections by venue-local year/month, not UTC, and retains year metadata', async () => {
    const response = await app.inject({ url: `/api/open-mics/${seriesId}/public-events?year=2100&month=1` });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([boundaryId]);
    expect(response.json().available_years).toContain(2100);
    const past = await app.inject({ url: `/api/open-mics/${seriesId}/public-events?period=past&year=2020&month=10` });
    expect(past.json().items.map((item: { title: string }) => item.title)).toEqual(['DST night B', 'DST night A']);
    const empty = await app.inject({ url: `/api/open-mics/${seriesId}/public-events?year=2100&month=3` });
    expect(empty.json().pagination.total).toBe(0);
    expect(empty.json().available_years).toContain(2100);
  });

  it('hides paused series through every public media surface while preserving management access', async () => {
    const profileUrl = `/api/profiles/${performerId}/media`;
    expect((await app.inject({ url: profileUrl })).json().items).toHaveLength(1);
    await pool.query("UPDATE open_mics SET status='paused' WHERE id=$1", [seriesId]);
    try {
      for (const url of [
        `/api/open-mics/${seriesId}/public-events`, `/api/open-mics/${seriesId}`,
        `/api/events/${runningId}`, `/api/events/${runningId}/media`,
        `/api/open-mics/${seriesId}/media`, `/api/open-mics/${seriesId}/featured-media`, `/api/media/${mediaId}`,
      ]) expect((await app.inject({ url })).statusCode, url).toBe(404);
      expect((await app.inject({ url: profileUrl })).json().items).toHaveLength(0);
      expect((await app.inject({ url: `/api/open-mics?owner_profile_id=${organizerId}` })).json().items).toHaveLength(0);
      for (const path of [`/events/${runningId}/media`, `/open-mics/${seriesId}/media`, `/open-mics/${seriesId}/featured-media`, `/media/${mediaId}`]) {
        expect((await app.inject({ url: `/api${path}?public_view=true`, headers })).statusCode).toBe(404);
        expect((await app.inject({ url: `/api${path}`, headers })).statusCode).toBe(200);
      }
      const og = await app.inject({ url: `/media/${mediaId}` });
      expect(og.body).not.toContain('Public photo');
      expect(og.body).not.toContain('og:image');
    } finally {
      await pool.query("UPDATE open_mics SET status='active' WHERE id=$1", [seriesId]);
    }
  });
});
