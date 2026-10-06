import type { Pool } from 'pg';
import { ValidationError } from '../errors.js';

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
  retired: boolean;
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
  retired: boolean;
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
    retired: row.retired,
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
    `SELECT id, city, city_ascii, country, country_ascii, iso2, iso3, admin_name, lat, lng, population, retired
     FROM cities WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function requireActiveCityById(pool: Pool, id: string, field: string): Promise<CityRow> {
  const city = await findCityById(pool, id);
  if (!city) throw new ValidationError(`${field} does not identify a known city`, { field });
  if (city.retired) {
    throw new ValidationError('The selected city is retired. Choose an active city or clear the city reference.', {
      field,
      reason: 'retired',
    });
  }
  return city;
}

export async function findCityIdsBySourceIds(pool: Pool, sourceIds: string[]): Promise<Map<string, string>> {
  if (!sourceIds.length) return new Map();
  const result = await pool.query<{ source_id: string; id: string }>(
    `SELECT source_id, id FROM cities
     WHERE source = 'worldcities' AND source_id = ANY($1::text[])`,
    [sourceIds],
  );
  return new Map(result.rows.map((row) => [row.source_id, row.id]));
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
         'retired', suggestions.retired,
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
