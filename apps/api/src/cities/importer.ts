import type { Pool } from 'pg';

import { withTransaction } from '../db.js';
import type { CityCatalogue } from './catalogue.js';

type ExistingCity = { source_id: string };
type UnexpectedSource = { source: string; count: string };

export type CityImportStats = {
  parsed: number;
  inserted: number;
  updated: number;
  linked: number;
  unexpectedSources: Array<{ source: string; count: number }>;
};

export type CityImportPreview = {
  parsed: number;
  existingManaged: number;
  toInsert: number;
  toUpdate: number;
  missingSourceIds: string[];
  unexpectedSources: Array<{ source: string; count: number }>;
};

async function inspectDatabase(pool: Pool, catalogue: CityCatalogue) {
  const [existing, unexpected] = await Promise.all([
    pool.query<ExistingCity>("SELECT source_id FROM cities WHERE source = 'worldcities'"),
    pool.query<UnexpectedSource>(
      "SELECT source, count(*)::text AS count FROM cities WHERE source <> 'worldcities' GROUP BY source ORDER BY source",
    ),
  ]);
  const importedIds = new Set(catalogue.cities.map((city) => city.source_id));
  const existingIds = new Set(existing.rows.map((city) => city.source_id));
  const missingSourceIds = [...existingIds].filter((sourceId) => !importedIds.has(sourceId)).sort();
  const toInsert = catalogue.cities.reduce((count, city) => count + Number(!existingIds.has(city.source_id)), 0);
  return {
    existingManaged: existingIds.size,
    toInsert,
    toUpdate: catalogue.cities.length - toInsert,
    missingSourceIds,
    unexpectedSources: unexpected.rows.map((row) => ({ source: row.source, count: Number(row.count) })),
  };
}

export async function previewCityCatalogueImport(pool: Pool, catalogue: CityCatalogue): Promise<CityImportPreview> {
  return {
    parsed: catalogue.cities.length,
    ...await inspectDatabase(pool, catalogue),
  };
}

export async function importCityCatalogue(pool: Pool, catalogue: CityCatalogue): Promise<CityImportStats> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<ExistingCity>("SELECT source_id FROM cities WHERE source = 'worldcities'");
    const importedIds = new Set(catalogue.cities.map((city) => city.source_id));
    const removed = [...new Set(current.rows.map((city) => city.source_id))]
      .filter((sourceId) => !importedIds.has(sourceId))
      .sort();
    if (removed.length) {
      const sample = removed.slice(0, 10).join(', ');
      throw new Error(
        `City catalogue omits ${removed.length} existing Simplemaps source identity/identities (${sample}). Retire entries instead of removing them.`,
      );
    }

    const unexpected = await client.query<UnexpectedSource>(
      "SELECT source, count(*)::text AS count FROM cities WHERE source <> 'worldcities' GROUP BY source ORDER BY source",
    );
    let inserted = 0;
    for (let offset = 0; offset < catalogue.cities.length; offset += 500) {
      const batch = catalogue.cities.slice(offset, offset + 500);
      const values: unknown[] = [];
      const tuples = batch.map((city) => {
        const base = values.length;
        values.push(
          'worldcities', city.source_id, city.city, city.city_ascii, city.country, city.country_ascii,
          city.iso2, city.iso3, city.admin_name, city.lat, city.lng, city.population,
          JSON.stringify({ capital: city.capital }), city.retired,
        );
        return `(${Array.from({ length: 14 }, (_, index) => `$${base + index + 1}`).join(', ')})`;
      });
      const result = await client.query<{ inserted: boolean }>(
        `INSERT INTO cities (
           source, source_id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name,
           lat, lng, population, source_metadata, retired
         ) VALUES ${tuples.join(', ')}
         ON CONFLICT (source, source_id) DO UPDATE SET
           city = EXCLUDED.city, city_ascii = EXCLUDED.city_ascii, country = EXCLUDED.country,
           country_ascii = EXCLUDED.country_ascii, iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3,
           admin_name = EXCLUDED.admin_name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           population = EXCLUDED.population, source_metadata = EXCLUDED.source_metadata,
           retired = EXCLUDED.retired, updated_at = now()
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
         WHERE a.city_id IS NULL AND a.city IS NOT NULL AND c.retired = false
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
         WHERE om.city_id IS NULL AND c.retired = false
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
         WHERE e.city_id IS NULL AND c.retired = false
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
         WHERE r.performer_city_id IS NULL AND r.performer_city IS NOT NULL AND c.retired = false
         GROUP BY r.id HAVING count(*) = 1
       )
       UPDATE registrations r SET performer_city_id = matches.city_id
       FROM matches WHERE r.id = matches.registration_id`,
    );
    const linked = [accountLinks, seriesLinks, eventLinks, registrationLinks]
      .reduce((sum, result) => sum + (result.rowCount ?? 0), 0);
    return {
      parsed: catalogue.cities.length,
      inserted,
      updated: catalogue.cities.length - inserted,
      linked,
      unexpectedSources: unexpected.rows.map((row) => ({ source: row.source, count: Number(row.count) })),
    };
  });
}
