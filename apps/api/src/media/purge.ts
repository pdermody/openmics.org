import type { Pool } from 'pg';

type PendingDeletion = {
  id: string;
  bucket: string;
  object_key: string;
  scheduled_for: string;
};

type PurgeLogger = Pick<Console, 'error'>;

export async function purgePendingMedia(
  pool: Pick<Pool, 'query'>,
  deleteObject: (bucket: string, objectKey: string) => Promise<void>,
  logger: PurgeLogger = console,
): Promise<{ due: number; processed: number; failed: number }> {
  const cutoff = (await pool.query<{ cutoff: string }>('SELECT now()::text AS cutoff')).rows[0].cutoff;
  let cursor: PendingDeletion | undefined;
  let total = 0;
  let processed = 0;
  let failed = 0;
  while (true) {
    const batch = await pool.query<PendingDeletion>(
      `SELECT id, bucket, object_key, scheduled_for::text AS scheduled_for
       FROM pending_s3_deletions
       WHERE processed_at IS NULL AND scheduled_for <= $2::timestamptz
         AND ($3::timestamptz IS NULL OR (scheduled_for, id) > ($3::timestamptz, $4::uuid))
       ORDER BY scheduled_for ASC, id ASC
       LIMIT $1`,
      [500, cutoff, cursor?.scheduled_for ?? null, cursor?.id ?? null],
    );
    total += batch.rows.length;
    for (const row of batch.rows) {
      try {
        await deleteObject(row.bucket, row.object_key);
        await pool.query('UPDATE pending_s3_deletions SET processed_at = now() WHERE id = $1', [row.id]);
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.error('Failed to purge media object', { id: row.id, error });
        await pool.query(
          'UPDATE pending_s3_deletions SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
          [row.id, error instanceof Error ? error.message : String(error)],
        );
      }
    }
    if (batch.rows.length < 500) break;
    // Keep the database timestamp's full precision so failed rows are not selected again.
    cursor = batch.rows[batch.rows.length - 1];
  }
  return { due: total, processed, failed };
}
