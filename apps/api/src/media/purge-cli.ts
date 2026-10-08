import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { purgePendingMedia } from './purge.js';
import { createS3MediaStorageAdapter } from './storage/s3-adapter.js';

if (process.argv.length > 2) throw new Error('Media purge does not accept command-line arguments.');
const config = loadConfig();
if (!config.mediaBucket) throw new Error('MEDIA_BUCKET is required for the media purge task.');
const storage = createS3MediaStorageAdapter({
  bucket: config.mediaBucket,
  cdnBaseUrl: config.mediaCdnBaseUrl,
  region: config.awsRegion,
});
const pool = createPool(config);
const timeout = setTimeout(() => {
  console.error('Media purge exceeded its five-minute runtime limit; unprocessed rows remain queued.');
  process.exit(1);
}, 300_000);
timeout.unref();

try {
  const result = await purgePendingMedia(pool, async (bucket, objectKey) => {
    if (bucket !== config.mediaBucket) throw new Error('Pending deletion references an unexpected media bucket.');
    await storage.deleteObject(objectKey);
  });
  console.log('Media purge run complete', result);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
  clearTimeout(timeout);
}
