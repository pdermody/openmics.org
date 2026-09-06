import { Pool, type PoolClient } from 'pg';

import type { AppConfig } from './config.js';

export function createPool(config: Pick<AppConfig, 'databaseUrl'>): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}

// Runs fn inside a transaction, committing on success and rolling back on any
// thrown error. Callers never see BEGIN/COMMIT/ROLLBACK directly.
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
