import type { Pool } from 'pg';

import { GeocodingUnavailableError, RateLimitedError } from '../errors.js';
import type { GeocodingService } from '../geocoding/service.js';
import { findExternalCitySearchCache, persistExternalCitySearch, type City } from './repository.js';

export async function searchExternalCities(
  pool: Pool,
  geocoding: GeocodingService,
  query: string,
): Promise<{ items: City[]; cached: boolean }> {
  const key = query.trim().toLocaleLowerCase();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SET lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', ['external-city-search', key]);
    locked = true;
    const cached = await findExternalCitySearchCache(pool, query);
    if (cached !== null) return { items: cached, cached: true };
    if (!geocoding.searchCities) throw new GeocodingUnavailableError('External city search is not configured on this server.');
    const candidates = await geocoding.searchCities(query);
    return { items: await persistExternalCitySearch(pool, query, candidates), cached: false };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
      throw new RateLimitedError('The external city search queue is full. Please try again shortly.');
    }
    throw error;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', ['external-city-search', key]);
    } finally {
      client.release();
    }
  }
}
