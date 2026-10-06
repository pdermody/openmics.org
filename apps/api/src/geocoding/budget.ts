import type { Pool } from 'pg';

import { GeocodingUnavailableError, RateLimitedError } from '../errors.js';

export async function withGeocodingCall<T>(
  pool: Pool,
  dailyLimit: number,
  makeRequest: () => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) throw new GeocodingUnavailableError('External city search is disabled.');
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(719283746)');
    locked = true;
    const schedule = await client.query<{ wait_ms: number }>(
      `SELECT GREATEST(0, EXTRACT(EPOCH FROM (next_allowed_at - now())) * 1000)::int AS wait_ms
       FROM geocoding_provider_schedule WHERE singleton = true`,
    );
    if (!schedule.rows[0]) throw new Error('Geocoding provider schedule is not initialized');
    await waitForGeocodingSlot(schedule.rows[0].wait_ms);
    await client.query('BEGIN');
    try {
      await client.query(
      `INSERT INTO geocoding_daily_usage (usage_date, calls) VALUES ((now() AT TIME ZONE 'UTC')::date, 0)
       ON CONFLICT (usage_date) DO NOTHING`,
      );
      const reservation = await client.query<{ calls: number }>(
        `UPDATE geocoding_daily_usage SET calls = calls + 1, updated_at = now()
         WHERE usage_date = (now() AT TIME ZONE 'UTC')::date AND calls < $1 RETURNING calls`,
        [dailyLimit],
      );
      if (!reservation.rows[0]) {
        throw new RateLimitedError('The daily external geocoding request limit has been reached.');
      }
      await client.query(
        `UPDATE geocoding_provider_schedule
         SET next_allowed_at = GREATEST(next_allowed_at, now()) + interval '500 milliseconds'
         WHERE singleton = true`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return await makeRequest();
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(719283746)');
    } finally {
      client.release();
    }
  }
}

export async function waitForGeocodingSlot(waitMs: number): Promise<void> {
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}
