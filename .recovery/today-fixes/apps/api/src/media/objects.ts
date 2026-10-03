import type { PoolClient } from 'pg';

import { insertPendingDeletion, type MediaRow } from './repository.js';

// Object keys of a photo's stored objects: the committed original plus its generated
// renditions. Videos store nothing on the platform (provider-hosted). Keys are derived
// from the stored public URLs so the purge worker targets exactly what was served.
export function mediaObjectKeys(media: MediaRow, cdnBaseUrl: string): string[] {
  if (media.media_type !== 'photo') return [];
  const prefix = `${cdnBaseUrl.replace(/\/$/, '')}/`;
  const keys: string[] = [];
  if (media.source_url.startsWith(prefix)) keys.push(media.source_url.slice(prefix.length));
  for (const [variant, rendition] of Object.entries(media.renditions ?? {})) {
    if (variant === 'original' || !rendition) continue;
    if (rendition.url.startsWith(prefix)) keys.push(rendition.url.slice(prefix.length));
  }
  return keys;
}

/**
 * Enqueues a media item's S3 objects into PendingS3Deletions, timed at the row's
 * recovery deadline. S3 is never deleted inline (data-model.md → Media); the hourly
 * purge Lambda performs the delete once the 30-day recovery window has elapsed.
 */
export async function enqueueMediaDeletions(
  client: PoolClient,
  media: MediaRow,
  options: { bucket: string; cdnBaseUrl: string; reason: 'purge' | 'replace' | 'abandoned_upload' | 'manual' },
): Promise<void> {
  if (!media.recovery_deadline) return;
  for (const objectKey of mediaObjectKeys(media, options.cdnBaseUrl)) {
    await insertPendingDeletion(client, {
      bucket: options.bucket,
      objectKey,
      mediaId: media.id,
      reason: options.reason,
      scheduledFor: media.recovery_deadline,
    });
  }
}
