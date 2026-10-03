import type { Handler } from 'aws-lambda';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

const dbSecretArn = process.env.DB_SECRET_ARN;

let cachedCredentials: { username: string; password: string } | undefined;
async function databaseCredentials(): Promise<{ username: string; password: string }> {
  if (cachedCredentials) return cachedCredentials;
  if (!dbSecretArn) throw new Error('DB_SECRET_ARN environment variable is required');
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: dbSecretArn }));
  if (!response.SecretString) throw new Error('Database secret has no string value');
  cachedCredentials = JSON.parse(response.SecretString) as { username: string; password: string };
  return cachedCredentials;
}

type PendingDeletion = {
  id: string;
  bucket: string;
  object_key: string;
};

const BATCH_LIMIT = 500;

/**
 * Hourly worker for the PendingS3Deletions queue. The API never deletes S3 objects
 * inline: soft-deleted media rows enqueue a deletion timed at their recovery deadline,
 * and this Lambda performs the actual object delete once that time has passed. Rows are
 * marked processed only after the object delete succeeds; failures stay queued and are
 * retried on the next run (S3 deletes are idempotent, so re-processing is safe).
 */
export const handler: Handler = async () => {
  const credentials = await databaseCredentials();
  const client = new pg.Client({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    user: credentials.username,
    password: credentials.password,
    // RDS rejects unencrypted connections; no-verify encrypts without the CA bundle.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const due = await client.query<PendingDeletion>(
      `SELECT id, bucket, object_key FROM pending_s3_deletions
       WHERE processed_at IS NULL AND scheduled_for <= now()
       ORDER BY scheduled_for ASC
       LIMIT $1`,
      [BATCH_LIMIT],
    );

    let processed = 0;
    for (const row of due.rows) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: row.bucket, Key: row.object_key }));
        await client.query('UPDATE pending_s3_deletions SET processed_at = now() WHERE id = $1', [row.id]);
        processed += 1;
      } catch (error) {
        console.error('Failed to delete S3 object', { id: row.id, bucket: row.bucket, key: row.object_key, error });
        await client.query(
          'UPDATE pending_s3_deletions SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
          [row.id, error instanceof Error ? error.message : String(error)],
        );
      }
    }

    console.log('Media purge run complete', { due: due.rows.length, processed });
    return { due: due.rows.length, processed };
  } finally {
    await client.end();
  }
};
