import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { buildApp } from '../../src/app.js';
import { parseCityCatalogue } from '../../src/cities/catalogue.js';
import type { CitySearchEntry } from '../../src/cities/catalogue.js';
import { importCityCatalogue } from '../../src/cities/importer.js';
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
  const providerCitySearch = vi.fn(async () => []);
  const cityEntry = (sourceId: string, name: string, options: {
    ascii?: string;
    country?: string;
    countryAscii?: string;
    iso2?: string;
    iso3?: string | null;
    admin?: string | null;
    lat?: number;
    lng?: number;
    population?: number | null;
    retired?: boolean;
  } = {}) => ({
    source_id: sourceId,
    city: name,
    city_ascii: options.ascii ?? name,
    country: options.country ?? 'Ireland',
    country_ascii: options.countryAscii ?? options.country ?? 'Ireland',
    iso2: options.iso2 ?? 'IE',
    iso3: options.iso3 === undefined ? 'IRL' : options.iso3,
    admin_name: options.admin ?? 'Leinster',
    lat: options.lat ?? 0,
    lng: options.lng ?? 0,
    population: options.population ?? 1000,
    capital: null,
    retired: options.retired ?? false,
  });
  const catalogueSource = {
    name: 'Test cities',
    edition: 'Test',
    url: 'https://example.test/cities',
    license: 'Test',
    license_url: 'https://example.test/license',
    converted_from: 'fixture',
  };
  const catalogueCities = [
    cityEntry('current', 'Origin'),
    cityEntry('suggested', 'Nearby', { lng: 1, admin: 'Munster', population: 2000 }),
    cityEntry('sao-low', 'Sao Paulo', { country: 'Brazil', iso2: 'BR', iso3: 'BRA', admin: 'South', lat: -23.5, lng: -46.6, population: 100 }),
    cityEntry('sao-high', 'Sao Paulo', { country: 'Brazil', iso2: 'BR', iso3: 'BRA', admin: 'North', lat: -23.4, lng: -46.5, population: 1000 }),
    cityEntry('sao-prefix', 'Sao Paulo East', { country: 'Brazil', iso2: 'BR', iso3: 'BRA', admin: 'East', lat: -23.3, lng: -46.4, population: 5000 }),
    cityEntry('missing', 'Unmapped Place'),
    cityEntry('retired', 'Retired Place', { retired: true }),
  ];
  const makeCatalogue = (cities: typeof catalogueCities) => parseCityCatalogue({
    version: 1,
    source: catalogueSource,
    cities,
  });
  const rawCityEntry = (city: CitySearchEntry, retired = city.retired) => cityEntry(city.source_id, city.city, {
    ascii: city.city_ascii,
    country: city.country,
    countryAscii: city.country_ascii,
    iso2: city.iso2,
    iso3: city.iso3,
    admin: city.admin_name,
    lat: city.lat,
    lng: city.lng,
    population: city.population,
    retired,
  });
  const cityCatalogue = makeCatalogue(catalogueCities);

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
       ('worldcities','current','Origin','Origin','Ireland','Ireland','IE','IRL','Leinster',0,0,1000),
       ('worldcities','suggested','Nearby','Nearby','Ireland','Ireland','IE','IRL','Munster',0,1,2000),
       ('worldcities','sao-low','Sao Paulo','Sao Paulo','Brazil','Brazil','BR','BRA','South',-23.5,-46.6,100),
       ('worldcities','sao-high','Sao Paulo','Sao Paulo','Brazil','Brazil','BR','BRA','North',-23.4,-46.5,1000),
       ('worldcities','sao-prefix','Sao Paulo East','Sao Paulo East','Brazil','Brazil','BR','BRA','East',-23.3,-46.4,5000)
       RETURNING id, source_id`,
    );
    currentCityId = cities.rows.find((city) => city.source_id === 'current')!.id;
    suggestedCityId = cities.rows.find((city) => city.source_id === 'suggested')!.id;
    app = buildApp({
      db: pool,
      logger: false,
      config: { databaseUrl: 'unused', environment: 'test', host: '127.0.0.1', port: 3000 },
      authVerifier: async (token) => token === 'owner' ? { accountId: ownerAccountId, isPlatformAdmin: false } : null,
      cityCatalogue,
      geocoding: {
        service: {
          searchAddress: providerCitySearch,
          reverseGeocode: async () => null,
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
    const search = await app.inject({ method: 'GET', url: '/api/cities/search?q=Origin' });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    expect(search.json().items[0]).toMatchObject({
      id: currentCityId, city: 'Origin', country: 'Ireland', iso2: 'IE', admin_name: 'Leinster', retired: false,
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
    expect((await app.inject({ method: 'GET', url: '/api/cities/search?q=Unmapped' })).json()).toMatchObject({
      error: { code: 'CITY_CATALOGUE_IMPORT_REQUIRED' },
    });
    expect((await app.inject({ method: 'GET', url: '/api/cities/search?q=Retired' })).json()).toEqual({ items: [] });
    expect((await app.inject({ method: 'GET', url: '/api/cities/search?q=x' })).statusCode).toBe(400);
    expect(providerCitySearch).not.toHaveBeenCalled();
    expect((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM geocoding_daily_usage')).rows[0].count).toBe('0');

    await pool.query("UPDATE cities SET city='Database-only name' WHERE id=$1", [currentCityId]);
    try {
      const authoritativeSearch = await app.inject({ method: 'GET', url: '/api/cities/search?q=Origin' });
      expect(authoritativeSearch.json().items[0]).toMatchObject({ id: currentCityId, city: 'Origin' });
      const databaseDetail = await app.inject({ method: 'GET', url: `/api/cities/${currentCityId}` });
      expect(databaseDetail.json()).toMatchObject({ city: 'Database-only name' });
    } finally {
      await pool.query("UPDATE cities SET city='Origin' WHERE id=$1", [currentCityId]);
    }
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
    await pool.query(
      `INSERT INTO cities (source,source_id,city,city_ascii,country,country_ascii,iso2,lat,lng)
       VALUES ('legacy','preserved','Legacy Other','Legacy Other','Canada','Canada','CA',0,0)`,
    );
    const importCatalogue = makeCatalogue([
      ...catalogueCities.filter((city) => city.source_id !== 'missing' && city.source_id !== 'retired'),
      cityEntry('import-a', 'Import Town', { country: 'Canada', iso2: 'CA', iso3: 'CAN', admin: 'North', lat: 45, lng: -75, population: 1000 }),
      cityEntry('import-b', 'Import Town', { country: 'Canada', iso2: 'CA', iso3: 'CAN', admin: 'South', lat: 46, lng: -76, population: 900 }),
      cityEntry('import-c', 'Unique Town', { country: 'Canada', iso2: 'CA', iso3: 'CAN', admin: 'Region', lat: 47, lng: -77, population: 800 }),
    ]);
    const first = await importCityCatalogue(pool, importCatalogue);
    expect(first).toMatchObject({
      parsed: 8, inserted: 3, updated: 5, linked: 2,
      unexpectedSources: [{ source: 'legacy', count: 1 }],
    });
    const uniqueAccountId = (await pool.query<{ city_id: string }>('SELECT city_id FROM accounts WHERE id=$1', [legacyAccount.rows[0].id])).rows[0].city_id;
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [uniqueSeries.rows[0].id])).rows[0].city_id)
      .toBe(uniqueAccountId);
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [ambiguousSeries.rows[0].id])).rows[0].city_id)
      .toBeNull();
    const cityId = (await pool.query<{ id: string }>("SELECT id FROM cities WHERE source='worldcities' AND source_id='import-c'")).rows[0].id;
    const second = await importCityCatalogue(pool, importCatalogue);
    expect(second).toMatchObject({ parsed: 8, inserted: 0, updated: 8, linked: 0 });
    expect((await pool.query<{ city_id: string }>('SELECT city_id FROM open_mics WHERE id=$1', [uniqueSeries.rows[0].id])).rows[0].city_id)
      .toBe(uniqueAccountId);
    const retiredCatalogue = makeCatalogue(importCatalogue.cities.map((city) => rawCityEntry(city, city.source_id === 'import-c')));
    await importCityCatalogue(pool, retiredCatalogue);
    expect((await pool.query<{ id: string; retired: boolean }>(
      "SELECT id, retired FROM cities WHERE source='worldcities' AND source_id='import-c'",
    )).rows[0]).toEqual({ id: cityId, retired: true });
    await expect(importCityCatalogue(pool, makeCatalogue(
      importCatalogue.cities.slice(1).map((city) => rawCityEntry(city)),
    )))
      .rejects.toThrow(/Retire entries instead of removing them/);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cities WHERE source='legacy'")).rows[0].count).toBe('1');
    await pool.query('UPDATE open_mics SET deleted_at=now() WHERE id=ANY($1::uuid[])', [
      [uniqueSeries.rows[0].id, ambiguousSeries.rows[0].id],
    ]);
  });

  it('removes the city-provider operation without changing organizer geocoding routes', async () => {
    const removed = await app.inject({ method: 'POST', url: '/api/cities/search-external', payload: { q: 'Fake harbour' } });
    expect(removed.statusCode).toBe(404);
    const citySearch = await app.inject({ method: 'GET', url: '/api/cities/search?q=Origin' });
    expect(citySearch.statusCode).toBe(200);
    const geocode = await app.inject({ method: 'GET', url: '/api/geocoding/search?q=Main+Street', headers: { authorization: 'Bearer owner' } });
    expect(geocode.statusCode).toBe(200);
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
    expect(series.statusCode, series.body).toBe(201);
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

  it('blocks retired-city detail edits but preserves explicit clearing and lifecycle operations', async () => {
    const headers = { authorization: 'Bearer owner' };
    const retirementProfile = await pool.query<{ id: string }>(
      "INSERT INTO profiles (created_by_account_id,profile_name,profile_kind) VALUES ($1,'Retirement Organizer','organizer') RETURNING id",
      [ownerAccountId],
    );
    const series = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { ...headers, 'x-current-profile': retirementProfile.rows[0].id },
      payload: {
        name: 'Retirement test series', venue_name: 'Venue', address_line1: 'Street', city_id: currentCityId,
        time_zone: 'UTC', activities: ['singing'], status: 'active',
      },
    });
    expect(series.statusCode, series.body).toBe(201);
    await pool.query("UPDATE open_mics SET status='active' WHERE id=$1", [series.json().id]);
    const event = await app.inject({
      method: 'POST',
      url: `/api/open-mics/${series.json().id}/events`,
      headers,
      payload: {
        title: 'Retirement test event', starts_at: '2100-01-01T19:00:00Z', ends_at: '2100-01-01T21:00:00Z',
        time_zone: 'UTC', status: 'published', capacity: 10,
      },
    });
    expect(event.statusCode, event.body).toBe(201);
    const registration = await app.inject({
      method: 'POST',
      url: `/api/events/${event.json().id}/registrations`,
      payload: {
        performer_name: 'Retirement test guest', performer_city_id: currentCityId,
        contact_email: 'retirement-test@example.test', submission_channel: 'organic', organizer_supervised: false,
      },
    });
    expect(registration.statusCode).toBe(201);
    expect((await app.inject({
      method: 'PATCH', url: `/api/accounts/${ownerAccountId}`, headers, payload: { city_id: currentCityId },
    })).statusCode).toBe(200);
    await pool.query('UPDATE cities SET retired = true WHERE id = ANY($1::uuid[])', [[currentCityId, suggestedCityId]]);

    const accountEdit = await app.inject({
      method: 'PATCH', url: `/api/accounts/${ownerAccountId}`, headers, payload: { display_name: 'Blocked edit' },
    });
    expect(accountEdit.statusCode).toBe(400);
    expect(accountEdit.json().error.details).toMatchObject({ field: 'city_id', reason: 'retired' });
    expect((await app.inject({
      method: 'PATCH', url: `/api/accounts/${ownerAccountId}`, headers, payload: { city_id: null },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/accounts/${ownerAccountId}`, headers, payload: { display_name: 'Allowed after clear' },
    })).statusCode).toBe(200);

    const seriesEdit = await app.inject({
      method: 'PATCH', url: `/api/open-mics/${series.json().id}`, headers, payload: { name: 'Blocked rename' },
    });
    expect(seriesEdit.statusCode).toBe(400);
    expect(seriesEdit.json().error.details).toMatchObject({ field: 'city_id', reason: 'retired' });
    expect((await app.inject({
      method: 'PATCH', url: `/api/open-mics/${series.json().id}`, headers, payload: { status: 'paused' },
    })).statusCode).toBe(200);
    const inherited = await app.inject({
      method: 'POST',
      url: `/api/open-mics/${series.json().id}/events`,
      headers,
      payload: {
        title: 'Blocked inherited city', starts_at: '2100-02-01T19:00:00Z', ends_at: '2100-02-01T21:00:00Z',
        time_zone: 'UTC', capacity: 10,
      },
    });
    expect(inherited.statusCode).toBe(400);
    const clearedInherited = await app.inject({
      method: 'POST',
      url: `/api/open-mics/${series.json().id}/events`,
      headers,
      payload: {
        title: 'Cleared inherited city', starts_at: '2100-03-01T19:00:00Z', ends_at: '2100-03-01T21:00:00Z',
        time_zone: 'UTC', city_id: null, capacity: 10,
      },
    });
    expect(clearedInherited.statusCode).toBe(201);
    expect(clearedInherited.json()).toMatchObject({ city_id: null, city: 'Origin' });
    expect((await app.inject({
      method: 'PATCH', url: `/api/open-mics/${series.json().id}`, headers, payload: { status: 'active', name: 'Mixed edit' },
    })).statusCode).toBe(400);
    const clearedSeries = await app.inject({
      method: 'PATCH', url: `/api/open-mics/${series.json().id}`, headers, payload: { city_id: null, name: 'Cleared series' },
    });
    expect(clearedSeries.statusCode).toBe(200);
    expect(clearedSeries.json()).toMatchObject({ city_id: null, city: 'Origin' });

    const eventEdit = await app.inject({
      method: 'PATCH', url: `/api/events/${event.json().id}`, headers, payload: { title: 'Blocked event edit' },
    });
    expect(eventEdit.statusCode).toBe(400);
    expect(eventEdit.json().error.details).toMatchObject({ field: 'city_id', reason: 'retired' });
    expect((await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.json().id}`,
      headers,
      payload: { registrations_closed_at: '2100-01-01T18:00:00Z' },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'PATCH', url: `/api/events/${event.json().id}`, headers, payload: { status: 'published', title: 'Mixed edit' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: `/api/events/${event.json().id}`, headers, payload: { city_id: null, title: 'Cleared event' },
    })).statusCode).toBe(200);

    const selectedRetired = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { ...headers, 'x-current-profile': retirementProfile.rows[0].id },
      payload: {
        name: 'Rejected retired selection', venue_name: 'Venue', address_line1: 'Street', city_id: suggestedCityId,
        time_zone: 'UTC', activities: ['singing'],
      },
    });
    expect(selectedRetired.statusCode).toBe(400);
    const registrationEdit = await app.inject({
      method: 'PATCH',
      url: `/api/registrations/${registration.json().id}`,
      headers,
      payload: { performer_name: 'Blocked guest edit' },
    });
    expect(registrationEdit.statusCode).toBe(400);
    expect(registrationEdit.json().error.details).toMatchObject({ field: 'performer_city_id', reason: 'retired' });
    const clearedRegistration = await app.inject({
      method: 'PATCH',
      url: `/api/registrations/${registration.json().id}`,
      headers,
      payload: { performer_city_id: null, performer_name: 'Allowed after clear' },
    });
    expect(clearedRegistration.statusCode).toBe(200);
    expect(clearedRegistration.json()).toMatchObject({ performer_city: 'Origin', performer_city_id: null });
    const newRetiredRegistration = await app.inject({
      method: 'POST',
      url: `/api/events/${event.json().id}/registrations`,
      payload: {
        performer_name: 'Rejected retired guest', performer_city_id: suggestedCityId,
        contact_email: 'retired-new@example.test', submission_channel: 'organic', organizer_supervised: false,
      },
    });
    expect(newRetiredRegistration.statusCode).toBe(400);
  });

  it('uses active public series only and returns exact expansion thresholds, ties and city counts', async () => {
    await pool.query('UPDATE cities SET retired = true WHERE id = $1', [suggestedCityId]);
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
      id: suggestedCityId, open_mic_count: 2, distance_km: expect.any(Number), retired: true,
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
