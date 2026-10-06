import { parse } from 'csv-parse/sync';
import type { Pool } from 'pg';

import { withTransaction } from '../db.js';

const REQUIRED_HEADERS = ['id', 'admin_name', 'city', 'city_ascii', 'country', 'iso2', 'iso3', 'lat', 'lng', 'population'] as const;

export type CityImportRow = {
  sourceId: string;
  adminName: string | null;
  city: string;
  cityAscii: string;
  country: string;
  countryAscii: string;
  iso2: string;
  iso3: string | null;
  lat: number;
  lng: number;
  population: number | null;
  metadata: { capital: string | null };
};

export type CityImportStats = { parsed: number; inserted: number; updated: number; duplicates: number; linked: number };

function asciiSearchName(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x00-\x7F]/g, '');
}

export function parseCityCsv(contents: string): { rows: CityImportRow[]; duplicates: number } {
  const records = parse(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: false,
  }) as Record<string, string>[];
  if (records.length === 0) throw new Error('City CSV contains no data rows');
  const headers = Object.keys(records[0]);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`City CSV is missing required headers: ${missing.join(', ')}`);

  const bySourceId = new Map<string, CityImportRow>();
  let duplicates = 0;
  for (const [index, record] of records.entries()) {
    const line = index + 2;
    const sourceId = record.id?.trim();
    const city = record.city?.trim();
    const country = record.country?.trim();
    const iso2 = record.iso2?.trim().toUpperCase();
    const iso3 = record.iso3?.trim().toUpperCase() || null;
    const lat = Number(record.lat);
    const lng = Number(record.lng);
    const population = record.population?.trim() ? Number(record.population) : null;
    const cityAscii = record.city_ascii?.trim() || (city ? asciiSearchName(city) : '');
    if (!sourceId || !city || !cityAscii || !country || !iso2 || !/^[A-Z]{2}$/.test(iso2)) {
      throw new Error(`City CSV line ${line} has a missing or invalid identity field`);
    }
    if (iso3 !== null && !/^[A-Z]{3}$/.test(iso3)) throw new Error(`City CSV line ${line} has an invalid ISO3 code`);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`City CSV line ${line} has invalid coordinates`);
    }
    if (population !== null && (!Number.isSafeInteger(population) || population < 0)) {
      throw new Error(`City CSV line ${line} has an invalid population`);
    }
    const row: CityImportRow = {
      sourceId,
      adminName: record.admin_name?.trim() || null,
      city,
      cityAscii,
      country,
      countryAscii: asciiSearchName(country),
      iso2,
      iso3,
      lat,
      lng,
      population,
      metadata: { capital: record.capital?.trim() || null },
    };
    const existing = bySourceId.get(sourceId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(row)) {
        throw new Error(`City CSV has conflicting duplicate source id ${sourceId} at line ${line}`);
      }
      duplicates += 1;
      continue;
    }
    bySourceId.set(sourceId, row);
  }
  return { rows: [...bySourceId.values()], duplicates };
}

export async function importCityCsv(pool: Pool, contents: string): Promise<CityImportStats> {
  const parsed = parseCityCsv(contents);
  let inserted = 0;
  let updated = 0;
  let linked = 0;
  await withTransaction(pool, async (client) => {
    for (let offset = 0; offset < parsed.rows.length; offset += 500) {
      const batch = parsed.rows.slice(offset, offset + 500);
      const values: unknown[] = [];
      const tuples = batch.map((row) => {
        const base = values.length;
        values.push(
          'worldcities', row.sourceId, row.city, row.cityAscii, row.country, row.countryAscii,
          row.iso2, row.iso3, row.adminName, row.lat, row.lng, row.population, JSON.stringify(row.metadata),
        );
        return `(${Array.from({ length: 13 }, (_, i) => `$${base + i + 1}`).join(', ')})`;
      });
      const result = await client.query<{ inserted: boolean }>(
        `INSERT INTO cities (
           source, source_id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name, lat, lng, population, source_metadata
         ) VALUES ${tuples.join(', ')}
         ON CONFLICT (source, source_id) DO UPDATE SET
           city = EXCLUDED.city, city_ascii = EXCLUDED.city_ascii, country = EXCLUDED.country,
           country_ascii = EXCLUDED.country_ascii, iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3,
           admin_name = EXCLUDED.admin_name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           population = EXCLUDED.population, source_metadata = EXCLUDED.source_metadata,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        values,
      );
      inserted += result.rows.filter((row) => row.inserted).length;
    }
    const accountLinks = await client.query(
      `WITH matches AS (
         SELECT a.id AS account_id, (array_agg(c.id))[1] AS city_id
         FROM accounts a JOIN cities c
           ON lower(c.city) = lower(a.city) OR lower(c.city_ascii) = lower(a.city)
         WHERE a.city_id IS NULL AND a.city IS NOT NULL
         GROUP BY a.id HAVING count(*) = 1
       )
       UPDATE accounts a SET city_id = matches.city_id
       FROM matches WHERE a.id = matches.account_id`,
    );
    const seriesLinks = await client.query(
      `WITH matches AS (
         SELECT om.id AS resource_id, (array_agg(c.id))[1] AS city_id
         FROM open_mics om JOIN cities c
           ON (lower(c.city) = lower(om.city) OR lower(c.city_ascii) = lower(om.city))
          AND (lower(c.country) = lower(om.country) OR lower(c.country_ascii) = lower(om.country))
         WHERE om.city_id IS NULL
         GROUP BY om.id HAVING count(*) = 1
       )
       UPDATE open_mics om SET city_id = matches.city_id
       FROM matches WHERE om.id = matches.resource_id`,
    );
    const eventLinks = await client.query(
      `WITH matches AS (
         SELECT e.id AS resource_id, (array_agg(c.id))[1] AS city_id
         FROM events e JOIN cities c
           ON (lower(c.city) = lower(e.city) OR lower(c.city_ascii) = lower(e.city))
          AND (lower(c.country) = lower(e.country) OR lower(c.country_ascii) = lower(e.country))
         WHERE e.city_id IS NULL
         GROUP BY e.id HAVING count(*) = 1
       )
       UPDATE events e SET city_id = matches.city_id
       FROM matches WHERE e.id = matches.resource_id`,
    );
    const registrationLinks = await client.query(
      `WITH matches AS (
         SELECT r.id AS registration_id, (array_agg(c.id))[1] AS city_id
         FROM registrations r JOIN cities c
           ON lower(c.city) = lower(r.performer_city) OR lower(c.city_ascii) = lower(r.performer_city)
         WHERE r.performer_city_id IS NULL AND r.performer_city IS NOT NULL
         GROUP BY r.id HAVING count(*) = 1
       )
       UPDATE registrations r SET performer_city_id = matches.city_id
       FROM matches WHERE r.id = matches.registration_id`,
    );
    linked = [accountLinks, seriesLinks, eventLinks, registrationLinks]
      .reduce((sum, result) => sum + (result.rowCount ?? 0), 0);
  });
  return { parsed: parsed.rows.length, inserted, updated: parsed.rows.length - inserted, duplicates: parsed.duplicates, linked };
}
