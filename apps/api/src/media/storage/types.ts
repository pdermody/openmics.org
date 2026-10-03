// Object-store boundary for the media pipeline. Production talks to S3
// (s3-adapter.ts); unit/API tests and local dev use the in-memory fake
// (local-fake.ts). The adapter is a pure object store: enqueueing deletions into the
// PendingS3Deletions *database* table lives in the media repository, which has the pool.

export type PresignedUpload = {
  uploadUrl: string;
  objectKey: string;
  expiresAt: Date;
};

export type CreatePresignedUploadInput = {
  ownerAccountId: string;
  mimeType: string;
  sizeBytes: number;
  /** Server-derived from the MIME allowlist (never the client's filename). */
  extension: string;
  expiresInSeconds: number;
};

export type StoredObjectInfo = {
  sizeBytes: number;
  contentType: string;
};

export type RenditionVariantName = 'thumb' | 'grid' | 'lightbox';

export type MediaStorageAdapter = {
  /** Reserves an upload slot: returns a presigned PUT URL for a server-generated tmp key. */
  createPresignedUploadUrl(input: CreatePresignedUploadInput): Promise<PresignedUpload>;
  /** HEAD a pending tmp object; null when it does not exist (never uploaded / expired). */
  statPendingObject(objectKey: string): Promise<StoredObjectInfo | null>;
  /**
   * Moves a pending tmp object to its canonical `original/{mediaId}.{ext}` location
   * (copy + delete) with immutable cache headers. Returns the canonical key and the
   * object's actual size/type — the server trusts these, not the client's declarations.
   * Returns null when the pending object no longer exists.
   */
  commitObject(objectKey: string, mediaId: string): Promise<({ objectKey: string } & StoredObjectInfo) | null>;
  /** Public CDN URL for a committed object key. */
  publicUrl(objectKey: string): string;
  /** Public CDN URL for a generated rendition of a media item. */
  publicRenditionUrl(mediaId: string, variant: RenditionVariantName): string;
  /** Direct delete — reserved for commit-time validation failures; normal deletes queue. */
  deleteObject(objectKey: string): Promise<void>;
};
