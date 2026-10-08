import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { purgePendingMedia } from '../../src/media/purge.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from './database.js';

describe('scheduled media purge (real database)', () => {
  let database: TestDatabase;
  let pool: Pool;
  const logger = { error: vi.fn() };

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = database.pool;
  });
  afterAll(async () => {
    await stopTestDatabase(database);
  });
  beforeEach(async () => {
    logger.error.mockClear();
    await pool.query('TRUNCATE pending_s3_deletions');
  });

  async function insert(objectKey: string, scheduledFor: Date, processed = false) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO pending_s3_deletions (bucket, object_key, reason, scheduled_for, processed_at)
       VALUES ('media-test', $1, 'manual', $2, CASE WHEN $3 THEN now() ELSE NULL END)
       RETURNING id`,
      [objectKey, scheduledFor, processed],
    );
    return result.rows[0].id;
  }

  it('deletes only due unprocessed objects and never repeats completed rows', async () => {
    const due = await insert('original/due.webp', new Date(Date.now() - 60_000));
    const future = await insert('original/future.webp', new Date(Date.now() + 3_600_000));
    await insert('original/processed.webp', new Date(Date.now() - 60_000), true);
    const deleteObject = vi.fn(async (_bucket: string, _key: string) => {});
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 1, processed: 1, failed: 0 });
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith('media-test', 'original/due.webp');
    const status = await pool.query<{ id: string; processed_at: Date | null }>(
      'SELECT id, processed_at FROM pending_s3_deletions WHERE id = ANY($1::uuid[])',
      [[due, future]],
    );
    expect(status.rows.find((row) => row.id === due)?.processed_at).toBeInstanceOf(Date);
    expect(status.rows.find((row) => row.id === future)?.processed_at).toBeNull();
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 0, processed: 0, failed: 0 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it('records failures without marking processed and succeeds on a later run', async () => {
    const id = await insert('original/retry.webp', new Date(Date.now() - 60_000));
    const deleteObject = vi.fn(async (_bucket: string, _key: string) => {}).mockRejectedValueOnce(new Error('S3 unavailable'));
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 1, processed: 0, failed: 1 });
    const failure = await pool.query<{ attempts: number; last_error: string; processed_at: Date | null }>(
      'SELECT attempts, last_error, processed_at FROM pending_s3_deletions WHERE id = $1', [id],
    );
    expect(failure.rows[0]).toEqual({ attempts: 1, last_error: 'S3 unavailable', processed_at: null });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 1, processed: 1, failed: 0 });
  });

  it('continues to other due objects after an object deletion fails', async () => {
    await insert('original/first.webp', new Date(Date.now() - 120_000));
    await insert('original/second.webp', new Date(Date.now() - 60_000));
    const deleteObject = vi.fn(async (_bucket: string, _key: string) => {}).mockRejectedValueOnce(new Error('Access denied'));
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 2, processed: 1, failed: 1 });
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it('processes more than 500 queued objects in one run using bounded batches', async () => {
    await pool.query(
      `INSERT INTO pending_s3_deletions (bucket, object_key, reason, scheduled_for)
       SELECT 'media-test', 'original/' || n || '.webp', 'manual', now() - interval '1 minute'
       FROM generate_series(1, 501) AS n`,
    );
    const deleteObject = vi.fn(async (_bucket: string, _key: string) => {});
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 501, processed: 501, failed: 0 });
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 0, processed: 0, failed: 0 });
    expect(deleteObject).toHaveBeenCalledTimes(501);
  });

  it('does not retry failed rows at page boundaries, including sub-millisecond timestamps', async () => {
    await pool.query(
      `INSERT INTO pending_s3_deletions (bucket, object_key, reason, scheduled_for)
       SELECT 'media-test', 'original/' || n || '.webp', 'manual', '2020-01-01 00:00:00.123456+00'
       FROM generate_series(1, 501) AS n`,
    );
    const deleteObject = vi.fn(async (_bucket: string, _key: string) => {}).mockRejectedValue(new Error('Unavailable'));
    expect(await purgePendingMedia(pool, deleteObject, logger)).toEqual({ due: 501, processed: 0, failed: 501 });
    expect(deleteObject).toHaveBeenCalledTimes(501);
    const attempts = await pool.query<{ min: number; max: number }>(
      'SELECT min(attempts), max(attempts) FROM pending_s3_deletions',
    );
    expect(attempts.rows[0]).toEqual({ min: 1, max: 1 });
  });
});
