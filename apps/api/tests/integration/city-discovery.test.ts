import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { importCityCsv } from '../../src/cities/importer.js';
import { RateLimitedError } from '../../src/errors.js';
import { withGeocodingCall } from '../../src/geocoding/budget.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('city discovery endpoints and PostGIS queries', () => {
  let database: TestDatabase;
  let pool: Pool;
  let app: ReturnType<typeof buildApp>;
  let seriesIds: string[] = [];
  let currentCityId: string;
  let suggestedCityId: string;
  let ownerAccountId: string;
  let organizerId: string;
  let providerSearchCalls = 0;

  async function createSeries(name: string, distanceM: number, cityId: string | null = null) {
    const centre = await pool.query<{ lat: number; lng: number }>(
      `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng
       FROM (SELECT ST_Project(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, $1::float8, 0::float8) AS point) projected`,
      [distanceM],
    );
    const result = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (
        owner_profile_id, name, venue_name, address_line1, city, country, city_id, lat, lng,
        time_zone, activities, status
      ) VALUES ($1,$2,'Venue','Street','Dublin','Ireland',$3,$4,$5,'UTC',ARRAY['singing'],'active') RETURNING id`,
      [organizerId, name, cityId, centre.rows[0].lat, centre.rows[0].lng],
    );
    seriesIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
    const account = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id,email) VALUES ('city-discovery-owner','city-discovery@example.test') RETURNING id",
    );
    ownerAccountId = account.rows[0].id;
    const organizer = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id,profile_name,profile_kind) VALUES ($1,'City Organizer','organizer') RETURNING id",
      [ownerAccountId],
    );
    organizerId = organizer.rows[0].id;
    const cities = await pool.query<{ id: string; source_id: string }>(
      `INSERT INTO cities (source,source_id,city,city_ascii,country,country_ascii,iso2,iso3,admin_name,lat,lng,population)
       VALUES
       ('fixture','current','Origin','Origin','Ireland','Ireland','IE','IRL','Leinster',0,0,1000),
       ('fixture','suggested','Nearby','Nearby','Ireland','Ireland','IE','IRL','Munster',0,1,2000)
       RETURNING id, source_id`,
    );
    currentCityId = cities.rows.find((city) => city.source_id === 'current')!.id;
    suggestedCityId = cities.rows.find((city) => city.source_id === 'suggested')!.id;
    app = buildApp({
      db: pool,
      logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
      authVerifier: async (token) => token === 'owner' ? { accountId: ownerAccountId, isPlatformAdmin: false } : null,
      geocoding: {
        service: {
          searchAddress: async () => [],
          reverseGeocode: async () => null,
          searchCities: async (query) => {
            providerSearchCalls += 1;
            return query === 'Fake harbour' ? [{
              sourceId: 'fixture:fake-harbour', city: 'Fake Harbour', cityAscii: 'Fake Harbour',
              country: 'Ireland', countryAscii: 'Ireland', iso2: 'IE', iso3: null, adminName: 'Leinster',
              lat: 53.3, lng: -6.2, population: null,
            }] : [];
          },
        },
      },
    });
    await app.ready();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    if (database) await stopTestDatabase(database);
  }, 30000);

  it('searches the city catalogue with bounded Unicode/ASCII results and canonical details', async () => {
    await pool.query(
      `INSERT INTO cities (source,source_id,city,city_ascii,country,country_ascii,iso2,iso3,admin_name,lat,lng,population)
       VALUES
       ('fixture','sao-low','Sao Paulo','Sao Paulo','Brazil','Brazil','BR','BRA','South',-23.5,-46.6,100),
       ('fixture','sao-high','Sao Paulo','Sao Paulo','Brazil','Brazil','BR','BRA','North',-23.4,-46.5,1000),
       ('fixture','sao-prefix','Sao Paulo East','Sao Paulo East','Brazil','Brazil','BR','BRA','East',-23.3,-46.4,5000)`,
    );
    const search = await app.inject({ method: 'GET', url: '/api/cities/search?q=Origin' });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    expect(search.json().items[0]).toMatchObject({
      id: currentCityId, city: 'Origin', country: 'Ireland', iso2: 'IE', admin_name: 'Leinster',
    });
    const detail = await app.inject({ method: 'GET', url: `/api/cities/${currentCityId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(currentCityId);
    const prefix = await app.inject({ method: 'GET', url: '/api/cities/search?q=Ori' });
    expect(prefix.statusCode).toBe(200);
    const ranked = await app.inject({ method: 'GET', url: '/api/cities/search?q=Sao+Paulo' });
    expect(ranked.json().items.slice(0, 3).map((city: { id: string }) => city.id)).toHaveLength(3);
    expect(ranked.json().items[0]).toMatchObject({ city: 'Sao Paulo', admin_name: 'North', population: 1000, country: 'Brazil' });
    expect(ranked.json().items[1]).toMatchObject({ city: 'Sao Paulo', admin_name: 'South', population: 100 });
    expect(ranked.json().items[2].city).toBe('Sao Paulo East');
    expect((await app.inject({ method: 'GET', url: '/api/cities/search?q=x' })).statusCode).toBe(400);
  });

  it('idempotently imports source identities and links only unambiguous legacy snapshots', async () => {
    const legacyAccount = await pool.query<{ id: string }>(
      "INSERT INTO accounts (cognito_id,email,city) VALUES ('legacy-city-account','legacy-city@example.test','Unique Town') RETURNING id",
    );
    const uniqueSeries = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id,name,venue_name,address_line1,city,country,time_zone,activities)
       VALUES ($1,'Legacy unique','Venue','Street','Unique Town','Canada','UTC',ARRAY['singing']) RETURNING id`,
      [organizerId],
    );
    const ambiguousSeries = await pool.query<{ id: string }>(
      `INSERT INTO open_mics (owner_profile_id,name,venue_name,address_line1,city,country,time_zone,activities)
       VALUES ($1,'Legacy ambiguous','Venue','Street','Import Town','Canada','UTC',ARRAY['singing']) RETURNING id`,
      [organizerId],
    );
    const csv = [
      'id,admin_name,city,city_ascii,country,iso2,iso3,lat,lng,population,capital',
      'import-a,North,Import Town,Import Town,Canada,CA,CAN,45,-75,1000,',
      'import-b,South,Import Town,Import Town,Canada,CA,CAN,46,-76,900,',
      'import-c,Region,Unique Town,Unique Town,Canada,CA,CAN,47,-77,800,',
    ].join('\n');
    const first = await importCityCsv(pool, csv);
    expect(first).toMatchObject({ parsed: 3, inserted: 3, updated: 0, duplicates: 0, linked: 2 });
    const uniqueAccountId = (await pool.query<{ city_id: string }>('SELECT city_id FROM accounts WHERE id=$1', [legacyAccount.rows[0].id])).rows[0].city_id;
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [uniqueSeries.rows[0].id])).rows[0].city_id)
      .toBe(uniqueAccountId);
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [ambiguousSeries.rows[0].id])).rows[0].city_id)
      .toBeNull();
    const second = await importCityCsv(pool, csv);
    expect(second).toMatchObject({ parsed: 3, inserted: 0, updated: 3, duplicates: 0, linked: 0 });
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [uniqueSeries.rows[0].id])).rows[0].city_id)
      .toBe(uniqueAccountId);
    await pool.query('UPDATE open_mics SET deleted_at=now() WHERE id=ANY($1::uuid[])', [
      [uniqueSeries.rows[0].id, ambiguousSeries.rows[0].id],
    ]);
  });

  it('runs external city search only on explicit POST, persists confirmed identities and caches empty/successful results', async () => {
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/cities/search-external', payload: { q: 'Fake harbour' } }),
      app.inject({ method: 'POST', url: '/api/cities/search-external', payload: { q: 'Fake harbour' } }),
    ]);
    expect(first.statusCode).toBe(200);
    expect([first.json().cached, second.json().cached].sort()).toEqual([false, true]);
    expect(first.json().items).toMatchObject([{ city: 'Fake Harbour', iso2: 'IE' }]);
    expect(second.json().items).toMatchObject([{ id: first.json().items[0].id }]);
    expect(providerSearchCalls).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/cities/search?q=Fake' })).json().items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: first.json().items[0].id })]));

    const empty = await app.inject({ method: 'POST', url: '/api/cities/search-external', payload: { q: 'Empty place' } });
    expect(empty.json()).toEqual({ items: [], cached: false });
    const emptyCache = await app.inject({ method: 'POST', url: '/api/cities/search-external', payload: { q: 'Empty place' } });
    expect(emptyCache.json()).toEqual({ items: [], cached: true });
    expect(providerSearchCalls).toBe(2);
  });

  it('validates and derives selected city references across accounts, series, events and performer snapshots', async () => {
    const headers = { authorization: 'Bearer owner' };
    const accountUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${ownerAccountId}`,
      headers,
      payload: { city_id: currentCityId },
    });
    expect(accountUpdate.statusCode).toBe(200);
    expect(accountUpdate.json()).toMatchObject({
      city: 'Origin', city_id: currentCityId, city_location: { id: currentCityId, country: 'Ireland', lat: 0, lng: 0 },
    });
    expect((await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${ownerAccountId}`,
      headers,
      payload: { city_id: currentCityId, city: 'Cork' },
    })).statusCode).toBe(400);

    const series = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { ...headers, 'x-current-profile': organizerId },
      payload: {
        name: 'Selected city series', venue_name: 'Venue', address_line1: 'Street', city_id: currentCityId,
        time_zone: 'UTC', activities: ['singing'], status: 'active',
      },
    });
    expect(series.statusCode).toBe(201);
    expect(series.json()).toMatchObject({ city: 'Origin', country: 'Ireland', city_id: currentCityId });
    await pool.query("UPDATE open_mics SET status='active' WHERE id=$1", [series.json().id]);

    const event = await app.inject({
      method: 'POST',
      url: `/api/open-mics/${series.json().id}/events`,
      headers,
      payload: {
        title: 'Inherited city event', starts_at: '2100-01-01T19:00:00Z', ends_at: '2100-01-01T21:00:00Z',
        time_zone: 'UTC', status: 'published', capacity: 10,
      },
    });
    expect(event.statusCode, event.body).toBe(201);
    expect(event.json()).toMatchObject({ city: 'Origin', country: 'Ireland', city_id: currentCityId });
    const clearedEvent = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.json().id}`,
      headers,
      payload: { city_id: null },
    });
    expect(clearedEvent.statusCode).toBe(200);
    expect(clearedEvent.json()).toMatchObject({ city: 'Origin', city_id: null });

    const registration = await app.inject({
      method: 'POST',
      url: `/api/events/${event.json().id}/registrations`,
      payload: {
        performer_name: 'Guest performer', performer_city_id: suggestedCityId,
        contact_email: 'guest-city@example.test', submission_channel: 'organic', organizer_supervised: false,
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);
    expect(registration.json()).toMatchObject({ performer_city: 'Nearby', performer_city_id: suggestedCityId });
    const clearedRegistration = await app.inject({
      method: 'PATCH',
      url: `/api/registrations/${registration.json().id}`,
      headers,
      payload: { performer_city_id: null },
    });
    expect(clearedRegistration.statusCode).toBe(200);
    expect(clearedRegistration.json()).toMatchObject({ performer_city: 'Nearby', performer_city_id: null });
  });

  it('uses active public series only and returns exact expansion thresholds, ties and city counts', async () => {
    await createSeries('Inside current radius', 25000);
    for (let index = 0; index < 19; index++) await createSeries(`Distance ${index}`, 60000 + index * 1000);
    const tieOne = await createSeries('Threshold tie A', 79000, suggestedCityId);
    const tieTwo = await createSeries('Threshold tie B', 79000, suggestedCityId);
    await createSeries('Hidden draft', 79000);
    await pool.query("UPDATE open_mics SET status='draft' WHERE name='Hidden draft'");
    await createSeries('Hidden paused', 79000);
    await pool.query("UPDATE open_mics SET status='paused' WHERE name='Hidden paused'");
    await createSeries('Hidden ended', 79000);
    await pool.query("UPDATE open_mics SET status='ended' WHERE name='Hidden ended'");
    await createSeries('Deleted public', 79000);
    await pool.query("UPDATE open_mics SET deleted_at=now() WHERE name='Deleted public'");

    const url = `/api/discovery/suggestions?near=0,0&radius_km=50&city_id=${currentCityId}`;
    const initial = await app.inject({ method: 'GET', url });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().expansion).toEqual({ radius_km: 80, additional_count: 21 });
    const ownerView = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer owner' } });
    expect(ownerView.json().expansion).toEqual(initial.json().expansion);
    expect(initial.json().cities).toContainEqual(expect.objectContaining({
      id: suggestedCityId, open_mic_count: 2, distance_km: expect.any(Number),
    }));
    expect(initial.json().cities.some((city: { id: string }) => city.id === currentCityId)).toBe(false);

    await pool.query("UPDATE open_mics SET status='paused' WHERE name='Threshold tie A'");
    expect((await app.inject({ method: 'GET', url })).json().expansion).toEqual({ radius_km: 80, additional_count: 20 });
    await pool.query("UPDATE open_mics SET status='paused' WHERE name='Threshold tie B'");
    expect((await app.inject({ method: 'GET', url })).json().expansion).toEqual({ radius_km: 200, additional_count: 19 });

    await pool.query("UPDATE open_mics SET status='paused' WHERE name LIKE 'Distance %' AND name <> 'Distance 18'");
    expect((await app.inject({ method: 'GET', url })).json().expansion).toEqual({ radius_km: 200, additional_count: 1 });
    await pool.query("UPDATE open_mics SET status='paused' WHERE status='active' AND deleted_at IS NULL");
    expect((await app.inject({ method: 'GET', url })).json().expansion).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/discovery/suggestions?near=0,0&radius_km=200' })).json().expansion).toBeNull();

    const at50 = await createSeries('Exactly at current radius', 50000);
    await createSeries('Just outside current radius', 50100);
    const boundary = await pool.query<{ distance_m: number }>(
      `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(0,0),4326)::geography) AS distance_m
       FROM open_mics WHERE id=$1`,
      [at50],
    );
    const exactRadiusKm = boundary.rows[0].distance_m / 1000;
    const exactBoundary = await app.inject({
      method: 'GET',
      url: `/api/discovery/suggestions?near=0,0&radius_km=${exactRadiusKm}`,
    });
    expect(exactBoundary.json().expansion).toEqual({ radius_km: 200, additional_count: 1 });
    const justInside = await app.inject({
      method: 'GET',
      url: `/api/discovery/suggestions?near=0,0&radius_km=${(boundary.rows[0].distance_m - 0.01) / 1000}`,
    });
    expect(justInside.json().expansion).toEqual({ radius_km: 200, additional_count: 2 });

    await createSeries('Within 200 km boundary', 199900);
    await createSeries('Just outside 200 km boundary', 200100);
    const upperBound = await app.inject({
      method: 'GET',
      url: `/api/discovery/suggestions?near=0,0&radius_km=${exactRadiusKm}`,
    });
    expect(upperBound.json().expansion).toEqual({ radius_km: 200, additional_count: 2 });
    expect(tieOne).not.toBe(tieTwo);
  });

  it('paginates only published upcoming events beneath active public series with stable date ordering', async () => {
    const seriesId = await createSeries('Event parent', 10000);
    const nearerSeries = await createSeries('Nearest series', 5000);
    const fartherSeries = await createSeries('Farther series', 20000);
    const seriesList = await app.inject({
      method: 'GET', url: '/api/open-mics?near=0,0&radius_km=50&page_size=100',
    });
    const orderedSeries = seriesList.json().items as Array<{ id: string; distance_km: number }>;
    const nearestIndex = orderedSeries.findIndex((item) => item.id === nearerSeries);
    const parentIndex = orderedSeries.findIndex((item) => item.id === seriesId);
    const fartherIndex = orderedSeries.findIndex((item) => item.id === fartherSeries);
    expect(nearestIndex).toBeGreaterThanOrEqual(0);
    expect(nearestIndex).toBeLessThan(parentIndex);
    expect(parentIndex).toBeLessThan(fartherIndex);
    for (const [title, status] of [['A', 'published'], ['B', 'published'], ['C', 'published'], ['Hidden', 'draft']]) {
      await pool.query(
        `INSERT INTO events (
          open_mic_id,title,starts_at,ends_at,time_zone,status,venue_name,address_line1,city,country,lat,lng
        ) VALUES ($1,$2,'2100-01-01T19:00:00Z','2100-01-01T21:00:00Z','UTC',$3,'Venue','Street','Dublin','Ireland',0,0)`,
        [seriesId, title, status],
      );
    }
    const first = await app.inject({ method: 'GET', url: '/api/events/discovery?near=0,0&radius_km=50&page=1&page_size=2' });
    const second = await app.inject({ method: 'GET', url: '/api/events/discovery?near=0,0&radius_km=50&page=2&page_size=2' });
    expect(first.statusCode).toBe(200);
    expect(first.json().pagination).toEqual({ page: 1, page_size: 2, total: 3 });
    expect(first.json().items).toHaveLength(2);
    expect(second.json().items).toHaveLength(1);
    expect(new Set([...first.json().items, ...second.json().items].map((event: { id: string }) => event.id)).size).toBe(3);
    expect((await app.inject({ method: 'GET', url: '/api/events/discovery?radius_km=10' })).statusCode).toBe(400);

    const paused = await createSeries('Private event parent', 1000);
    await pool.query("UPDATE open_mics SET status='paused' WHERE id=$1", [paused]);
    await pool.query(
      `INSERT INTO events (
        open_mic_id,title,starts_at,ends_at,time_zone,status,venue_name,address_line1,city,country,lat,lng
      ) VALUES ($1,'Private event','2100-01-01T19:00:00Z','2100-01-01T21:00:00Z','UTC','published','Venue','Street','Dublin','Ireland',0,0)`,
      [paused],
    );
    const afterHidden = await app.inject({ method: 'GET', url: '/api/events/discovery?near=0,0&radius_km=50' });
    expect(afterHidden.json().pagination.total).toBe(3);
  });

  it('serializes provider budget reservations across requests and enforces the shared daily cap', async () => {
    await pool.query('DELETE FROM geocoding_daily_usage');
    const startedAt = Date.now();
    const work = () => withGeocodingCall(pool, 2, async () => 'called');
    await expect(Promise.all([work(), work()])).resolves.toEqual(['called', 'called']);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(450);
    const usage = await pool.query<{ calls: number }>('SELECT calls FROM geocoding_daily_usage WHERE usage_date=(now() AT TIME ZONE \'UTC\')::date');
    expect(usage.rows[0].calls).toBe(2);
    await expect(work()).rejects.toBeInstanceOf(RateLimitedError);
  });
});
