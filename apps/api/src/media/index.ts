import type { AppConfig } from '../config.js';
import { createLocalRenditionsQueueAdapter, createSqsRenditionsQueueAdapter } from './renditions/queue-adapter.js';
import { createLocalMediaStorageAdapter } from './storage/local-fake.js';
import { createS3MediaStorageAdapter } from './storage/s3-adapter.js';
import type { MediaStorageAdapter } from './storage/types.js';
import type { RenditionsQueueAdapter } from './renditions/queue-adapter.js';

export function createMediaStorageAdapter(config: AppConfig): MediaStorageAdapter {
  if (config.mediaStorageAdapter === 's3') {
    if (!config.mediaBucket) throw new Error('MEDIA_BUCKET is required when MEDIA_STORAGE_ADAPTER=s3');
    return createS3MediaStorageAdapter({
      bucket: config.mediaBucket,
      cdnBaseUrl: config.mediaCdnBaseUrl,
      region: config.awsRegion,
    });
  }
  return createLocalMediaStorageAdapter({ cdnBaseUrl: config.mediaCdnBaseUrl });
}

export function createRenditionsQueueAdapter(config: AppConfig): RenditionsQueueAdapter {
  if (config.mediaStorageAdapter === 's3') {
    if (!config.mediaRenditionsQueueUrl) {
      throw new Error('MEDIA_RENDITIONS_QUEUE_URL is required when MEDIA_STORAGE_ADAPTER=s3');
    }
    return createSqsRenditionsQueueAdapter({ queueUrl: config.mediaRenditionsQueueUrl, region: config.awsRegion });
  }
  return createLocalRenditionsQueueAdapter();
}

export type { MediaStorageAdapter } from './storage/types.js';
export type { LocalMediaStorageAdapter } from './storage/local-fake.js';
export { createLocalMediaStorageAdapter } from './storage/local-fake.js';
export type { RenditionsQueueAdapter, RenditionJob, LocalRenditionsQueueAdapter } from './renditions/queue-adapter.js';
export { createLocalRenditionsQueueAdapter } from './renditions/queue-adapter.js';
