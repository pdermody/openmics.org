import { randomUUID } from 'node:crypto';

import type { CreatePresignedUploadInput, MediaStorageAdapter, PresignedUpload, RenditionVariantName, StoredObjectInfo } from './types.js';

export type LocalMediaStorageAdapter = MediaStorageAdapter & {
  /** Test/dev assertion hook, mirroring the memory email adapter's `.sent[]`. */
  readonly objects: Map<string, StoredObjectInfo>;
  /** Marks a reserved tmp object as uploaded (tests never perform a real HTTP PUT). */
  simulateUpload(objectKey: string, info?: Partial<StoredObjectInfo>): void;
};

/**
 * Deterministic in-memory storage adapter for unit/API tests and local dev. No AWS and
 * no filesystem: "uploaded" bytes are just metadata entries in a map, and public URLs
 * point at the configured (fake) CDN base URL.
 */
export function createLocalMediaStorageAdapter(options: { cdnBaseUrl?: string } = {}): LocalMediaStorageAdapter {
  const baseUrl = (options.cdnBaseUrl ?? 'https://media.test').replace(/\/$/, '');
  const objects = new Map<string, StoredObjectInfo>();

  return {
    objects,

    simulateUpload(objectKey: string, info: Partial<StoredObjectInfo> = {}) {
      objects.set(objectKey, { sizeBytes: info.sizeBytes ?? 1024, contentType: info.contentType ?? 'image/jpeg' });
    },

    async createPresignedUploadUrl(input: CreatePresignedUploadInput): Promise<PresignedUpload> {
      const objectKey = `tmp/${input.ownerAccountId}/${randomUUID()}.${input.extension}`;
      return {
        uploadUrl: `${baseUrl}/presigned/${encodeURIComponent(objectKey)}`,
        objectKey,
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      };
    },

    async statPendingObject(objectKey: string): Promise<StoredObjectInfo | null> {
      if (!objectKey.startsWith('tmp/')) return null;
      return objects.get(objectKey) ?? null;
    },

    async commitObject(objectKey: string, mediaId: string) {
      const info = objects.get(objectKey) ?? null;
      if (!info || !objectKey.startsWith('tmp/')) return null;
      const extension = objectKey.split('.').pop();
      const canonicalKey = `original/${mediaId}.${extension}`;
      objects.delete(objectKey);
      objects.set(canonicalKey, info);
      return { objectKey: canonicalKey, ...info };
    },

    publicUrl(objectKey: string): string {
      return `${baseUrl}/${objectKey}`;
    },

    publicRenditionUrl(mediaId: string, variant: RenditionVariantName): string {
      return `${baseUrl}/renditions/${mediaId}/${variant}.webp`;
    },

    async deleteObject(objectKey: string): Promise<void> {
      objects.delete(objectKey);
    },
  };
}
