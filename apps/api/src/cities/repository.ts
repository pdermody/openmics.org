import type { Pool } from 'pg';
import { withTransaction } from '../db.js';
import type { ProviderCity } from '../geocoding/service.js';

export type CityRow = {
  id: string;
  city: string;
  city_ascii: string;
  country: string;
  country_ascii: string;
  iso2: string;
  iso3: string | null;
  admin_name: string | null;
  lat: string | number;
  lng: string | number;
  population: string | number | null;
};

export type City = {
  id: string;
  city: string;
  city_ascii: string;
  country: string;
  country_ascii: string;
  iso2: string;
  iso3: string | null;
  admin_name: string | null;
  lat: number;
  lng: number;
  population: number | null;
};

export function serializeCity(row: CityRow): City {
  return {
    id: row.id,
    city: row.city,
    city_ascii: row.city_ascii,
    country: row.country,
    country_ascii: row.country_ascii,
    iso2: row.iso2,
    iso3: row.iso3,
    admin_name: row.admin_name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    population: row.population === null ? null : Number(row.population),
  };
}

export function matchesCityName(city: Pick<CityRow, 'city' | 'city_ascii'>, value: string): boolean {
  const candidate = value.trim().toLocaleLowerCase();
  return [city.city, city.city_ascii].some((name) => name.toLocaleLowerCase() === candidate);
}

export function matchesCountryName(city: Pick<CityRow, 'country' | 'country_ascii'>, value: string): boolean {
  const candidate = value.trim().toLocaleLowerCase();
  return [city.country, city.country_ascii].some((name) => name.toLocaleLowerCase() === candidate);
}

export async function findCityById(pool: Pool, id: string): Promise<CityRow | null> {
  const result = await pool.query<CityRow>(
    `SELECT id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name, lat, lng, population
     FROM cities WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function searchCities(pool: Pool, query: string, country?: string): Promise<CityRow[]> {
  const normalized = query.trim();
  const escaped = normalized.replace(/[\\%_]/g, '\\$&');
  const values: unknown[] = [normalized, `${escaped}%`, `%${escaped}%`];
  const countryCondition = country ? `AND lower(iso2) = lower($4)` : '';
  if (country) values.push(country.trim());
  const result = await pool.query<CityRow>(
    `SELECT id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name, lat, lng, population
     FROM cities
     WHERE (
       lower(city) = lower($1) OR lower(city_ascii) = lower($1)
       OR lower(city) LIKE lower($2) ESCAPE E'\\\\' OR lower(city_ascii) LIKE lower($2) ESCAPE E'\\\\'
       OR lower(country) LIKE lower($3) ESCAPE E'\\\\' OR lower(country_ascii) LIKE lower($3) ESCAPE E'\\\\'
       OR city ILIKE $3 ESCAPE E'\\\\' OR city_ascii ILIKE $3 ESCAPE E'\\\\' OR country ILIKE $3 ESCAPE E'\\\\'
     ) ${countryCondition}
     ORDER BY
       CASE
         WHEN lower(city) = lower($1) OR lower(city_ascii) = lower($1) THEN 0
         WHEN lower(city) LIKE lower($2) ESCAPE E'\\\\' OR lower(city_ascii) LIKE lower($2) ESCAPE E'\\\\' THEN 1
         ELSE 2
       END,
       population DESC NULLS LAST, lower(country), lower(admin_name), lower(city), id
     LIMIT 10`,
    values,
  );
  return result.rows;
}

export async function persistExternalCitySearch(
  pool: Pool,
  query: string,
  providerCities: ProviderCity[],
): Promise<City[]> {
  return withTransaction(pool, async (client) => {
    const saved: City[] = [];
    for (const city of providerCities) {
      const result = await client.query<CityRow>(
        `INSERT INTO cities (
           source, source_id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name,
           lat, lng, population, source_metadata
         ) VALUES ('locationiq', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, '{"provider":"LocationIQ"}'::jsonb)
         ON CONFLICT (source, source_id) DO UPDATE SET
           city = EXCLUDED.city, city_ascii = EXCLUDED.city_ascii, country = EXCLUDED.country,
           country_ascii = EXCLUDED.country_ascii, iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3,
           admin_name = EXCLUDED.admin_name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()
         RETURNING id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name, lat, lng, population`,
        [city.sourceId, city.city, city.cityAscii, city.country, city.countryAscii, city.iso2, city.iso3, city.adminName, city.lat, city.lng],
      );
      saved.push(serializeCity(result.rows[0]));
    }
    const key = query.trim().toLocaleLowerCase();
    await client.query(
      `INSERT INTO city_search_cache (query, results, expires_at)
       VALUES ($1, $2::jsonb, now() + interval '24 hours')
       ON CONFLICT (query) DO UPDATE SET results = EXCLUDED.results,
         expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [key, JSON.stringify(saved)],
    );
    await client.query('DELETE FROM city_search_cache WHERE expires_at <= now() AND query <> $1', [key]);
    return saved;
  });
}

export async function findExternalCitySearchCache(pool: Pool, query: string): Promise<City[] | null> {
  const result = await pool.query<{ results: City[] }>(
    `SELECT results FROM city_search_cache WHERE query = $1 AND expires_at > now()`,
    [query.trim().toLocaleLowerCase()],
  );
  return result.rows[0]?.results ?? null;
}

export type DiscoverySuggestions = {
  expansion: { radius_km: number; additional_count: number } | null;
  cities: Array<City & { open_mic_count: number; distance_km: number }>;
};

export async function findDiscoverySuggestions(
  pool: Pool,
  input: { lat: number; lng: number; radiusKm: number; cityId?: string },
): Promise<DiscoverySuggestions> {
  const result = await pool.query<{
    expansion_radius_m: number | null;
    additional_count: string | null;
    cities: Array<CityRow & { open_mic_count: string; distance_km: number }>;
  }>(
    `WITH origin AS (
       SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS point
     ), public_series AS (
       SELECT om.city_id, om.location,
              CASE WHEN om.city_id IS NULL THEN NULL
                   ELSE ST_Distance(c.centre, origin.point) END AS city_distance,
              CASE WHEN om.location IS NULL THEN NULL
                   ELSE ST_Distance(om.location, origin.point) END AS series_distance
       FROM open_mics om
       CROSS JOIN origin
       LEFT JOIN cities c ON c.id = om.city_id
       WHERE om.status = 'active' AND om.deleted_at IS NULL
     ), expansion_candidates AS (
       SELECT series_distance
       FROM public_series
       WHERE series_distance > $3 AND series_distance <= 200000
     ), threshold AS (
       SELECT ceil(series_distance / 1000.0) * 1000 AS rounded_m
       FROM expansion_candidates
       ORDER BY series_distance
       OFFSET 19 LIMIT 1
     ), expansion AS (
       SELECT
         CASE
           WHEN $3 >= 200000 THEN NULL
           WHEN (SELECT rounded_m FROM threshold) IS NOT NULL THEN (SELECT rounded_m FROM threshold)
           WHEN EXISTS (SELECT 1 FROM expansion_candidates) THEN 200000
           ELSE NULL
         END AS radius_m,
         CASE
           WHEN $3 >= 200000 THEN NULL
           WHEN (SELECT rounded_m FROM threshold) IS NOT NULL THEN (
             SELECT count(*)::text FROM expansion_candidates
             WHERE series_distance <= (SELECT rounded_m FROM threshold)
           )
           WHEN EXISTS (SELECT 1 FROM expansion_candidates) THEN (SELECT count(*)::text FROM expansion_candidates)
           ELSE NULL
         END AS count
     ), city_counts AS (
       SELECT c.*, count(*)::text AS open_mic_count,
              ST_Distance(c.centre, origin.point) / 1000.0 AS distance_km
       FROM public_series ps
       JOIN cities c ON c.id = ps.city_id
       CROSS JOIN origin
       WHERE c.id IS DISTINCT FROM $4::uuid
       GROUP BY c.id, origin.point
     ), suggestions AS (
       SELECT * FROM city_counts
       ORDER BY distance_km, lower(country), lower(admin_name), lower(city), id
       LIMIT 6
     )
     SELECT expansion.radius_m AS expansion_radius_m, expansion.count AS additional_count,
       COALESCE(json_agg(json_build_object(
         'id', suggestions.id, 'city', suggestions.city, 'city_ascii', suggestions.city_ascii,
         'country', suggestions.country, 'country_ascii', suggestions.country_ascii,
         'iso2', suggestions.iso2, 'iso3', suggestions.iso3, 'admin_name', suggestions.admin_name,
         'lat', suggestions.lat, 'lng', suggestions.lng, 'population', suggestions.population,
         'open_mic_count', suggestions.open_mic_count, 'distance_km', suggestions.distance_km
       ) ORDER BY suggestions.distance_km, lower(suggestions.country), lower(suggestions.city), suggestions.id)
         FILTER (WHERE suggestions.id IS NOT NULL), '[]'::json) AS cities
     FROM expansion LEFT JOIN suggestions ON true
     GROUP BY expansion.radius_m, expansion.count`,
    [input.lat, input.lng, input.radiusKm * 1000, input.cityId ?? null],
  );
  const row = result.rows[0];
  const radiusM = row.expansion_radius_m;
  return {
    expansion: radiusM === null || row.additional_count === null
      ? null
      : { radius_km: radiusM / 1000, additional_count: Number(row.additional_count) },
    cities: row.cities.map((city) => ({
      ...serializeCity(city),
      open_mic_count: Number(city.open_mic_count),
      distance_km: Number(city.distance_km),
    })),
  };
}
