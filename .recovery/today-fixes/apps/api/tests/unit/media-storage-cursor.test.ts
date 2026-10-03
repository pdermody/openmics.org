import { describe, expect, it } from 'vitest';

import { decodeMediaCursor, encodeMediaCursor } from '../../src/media/cursor.js';
import { createLocalMediaStorageAdapter } from '../../src/media/index.js';

describe('media cursor codec', () => {
  it('round-trips opaque keyset cursors', () => {
    const payload = { s: 'shuffle' as const, e: 42, d: 'next' as const, k: 'abc123', i: 'some-id' };
    const encoded = encodeMediaCursor(payload);
    expect(encoded).not.toContain('{');
    expect(decodeMediaCursor(encoded)).toEqual(payload);
  });

  it('rejects malformed cursors', () => {
    expect(decodeMediaCursor('not-base64-json')).toBeNull();
    expect(decodeMediaCursor(Buffer.from('{"s":"bogus","d":"next","k":"a","i":"b"}').toString('base64url'))).toBeNull();
    expect(decodeMediaCursor(Buffer.from('{"s":"newest","d":"next","k":"a"}').toString('base64url'))).toBeNull();
  });
});

describe('local media storage adapter (deterministic test fake)', () => {
  it('reserves tmp keys, simulates uploads, and commits into original/', async () => {
    const storage = createLocalMediaStorageAdapter();
    const upload = await storage.createPresignedUploadUrl({
      ownerAccountId: 'account-1',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      extension: 'jpg',
      expiresInSeconds: 900,
    });
    expect(upload.objectKey).toMatch(/^tmp\/account-1\/.+\.jpg$/);
    expect(await storage.statPendingObject(upload.objectKey)).toBeNull();

    storage.simulateUpload(upload.objectKey, { sizeBytes: 1234, contentType: 'image/jpeg' });
    expect(await storage.statPendingObject(upload.objectKey)).toEqual({ sizeBytes: 1234, contentType: 'image/jpeg' });

    const committed = await storage.commitObject(upload.objectKey, 'media-1');
    expect(committed).toEqual({ objectKey: 'original/media-1.jpg', sizeBytes: 1234, contentType: 'image/jpeg' });
    expect(await storage.statPendingObject(upload.objectKey)).toBeNull();
    expect(storage.publicUrl(committed!.objectKey)).toBe('https://media.test/original/media-1.jpg');
    expect(storage.publicRenditionUrl('media-1', 'grid')).toBe('https://media.test/renditions/media-1/grid.webp');
  });

  it('returns null when committing a missing object', async () => {
    const storage = createLocalMediaStorageAdapter();
    expect(await storage.commitObject('tmp/account-1/nope.jpg', 'media-x')).toBeNull();
  });
});
