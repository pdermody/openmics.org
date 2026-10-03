import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { CreatePresignedUploadInput, MediaStorageAdapter, PresignedUpload, RenditionVariantName, StoredObjectInfo } from './types.js';

export type S3MediaStorageOptions = {
  bucket: string;
  cdnBaseUrl: string;
  region: string;
};

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * S3-backed media storage (decisions.md → Media delivery). Object keys are flat per
 * media id: uploads land on `tmp/{accountId}/{uuid}.{ext}` (24h lifecycle expiry) and
 * the commit step moves them to `original/{mediaId}.{ext}`. All objects are private;
 * public reads go through the media CDN distribution (OAC), so `publicUrl` composes
 * CDN URLs rather than S3 URLs.
 *
 * The presigned PUT binds Content-Type; byte size is enforced authoritatively at commit
 * time via HEAD (SigV4 presigned PUTs cannot enforce Content-Length — the declared size
 * is validated when the URL is issued and the actual size when the media is committed).
 */
export function createS3MediaStorageAdapter(options: S3MediaStorageOptions): MediaStorageAdapter {
  const client = new S3Client({ region: options.region });
  const baseUrl = options.cdnBaseUrl.replace(/\/$/, '');

  async function statObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: options.bucket, Key: objectKey }));
      return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'NotFound' || name === 'NoSuchKey' || name === 'Forbidden') return null;
      throw error;
    }
  }

  return {
    async createPresignedUploadUrl(input: CreatePresignedUploadInput): Promise<PresignedUpload> {
      const objectKey = `tmp/${input.ownerAccountId}/${randomUUID()}.${input.extension}`;
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: objectKey,
        ContentType: input.mimeType,
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
      return { uploadUrl, objectKey, expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000) };
    },

    statPendingObject: statObject,

    async commitObject(objectKey: string, mediaId: string) {
      const info = await statObject(objectKey);
      if (!info) return null;
      const extension = objectKey.split('.').pop();
      const canonicalKey = `original/${mediaId}.${extension}`;
      await client.send(new CopyObjectCommand({
        Bucket: options.bucket,
        Key: canonicalKey,
        CopySource: `${options.bucket}/${objectKey}`,
        ContentType: info.contentType,
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        MetadataDirective: 'COPY',
      }));
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey }));
      return { objectKey: canonicalKey, ...info };
    },

    publicUrl(objectKey: string): string {
      return `${baseUrl}/${objectKey}`;
    },

    publicRenditionUrl(mediaId: string, variant: RenditionVariantName): string {
      return `${baseUrl}/renditions/${mediaId}/${variant}.webp`;
    },

    async deleteObject(objectKey: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey }));
    },
  };
}
