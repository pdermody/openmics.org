import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createLocalMediaStorageAdapter, createLocalRenditionsQueueAdapter } from '../../src/media/index.js';

const ACCOUNT = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };
const MEDIA_ID = 'c0000000-0000-0000-0000-000000000009';
const EVENT_ID = 'e0000000-0000-0000-0000-000000000001';
const OPEN_MIC_ID = 'd0000000-0000-0000-0000-000000000001';

// API-surface tests: authentication matrix, input validation, and plan-rule rejections —
// everything that must hold WITHOUT touching the database. Behavioral coverage (real
// Postgres) lives in tests/integration/media.test.ts.
describe('media routes (API surface)', () => {
  const authVerifier = vi.fn(async (token: string) => (token === 'token-a' ? ACCOUNT : null));
  const mediaStorage = createLocalMediaStorageAdapter();
  const renditionsQueue = createLocalRenditionsQueueAdapter();
  const app = buildApp({
    config: { databaseUrl: 'postgres://unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }), resolveHandle: async () => null },
    authVerifier,
    mediaStorage,
    renditionsQueue,
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  describe('authentication matrix', () => {
    it('rejects unauthenticated writes and organizer-only reads', async () => {
      const cases = await Promise.all([
        app.inject({ method: 'POST', url: '/api/media/upload-url', payload: { media_type: 'photo', mime_type: 'image/jpeg', size_bytes: 10 } }),
        app.inject({ method: 'POST', url: '/api/media', payload: { media_type: 'photo', object_key: 'x' } }),
        app.inject({ method: 'POST', url: `/api/events/${EVENT_ID}/media`, payload: { media_type: 'photo', object_key: 'x' } }),
        app.inject({ method: 'POST', url: `/api/open-mics/${OPEN_MIC_ID}/media`, payload: { media_type: 'photo', object_key: 'x' } }),
        app.inject({ method: 'PATCH', url: `/api/media/${MEDIA_ID}`, payload: { caption: 'x' } }),
        app.inject({ method: 'DELETE', url: `/api/media/${MEDIA_ID}` }),
        app.inject({ method: 'POST', url: `/api/media/${MEDIA_ID}/recover` }),
        app.inject({ method: 'PUT', url: `/api/open-mics/${OPEN_MIC_ID}/featured-media`, payload: { media_ids: [] } }),
        app.inject({ method: 'GET', url: '/api/me/media/recently-deleted' }),
      ]);
      for (const response of cases) {
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('POST /media/upload-url', () => {
    it('rejects video uploads (videos are link-only)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media/upload-url',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'video', mime_type: 'video/mp4', size_bytes: 10 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('MEDIA_UPLOAD_INVALID');
    });

    it('rejects non-allowlisted MIME types before any storage work', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media/upload-url',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo', mime_type: 'image/heic', size_bytes: 10 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('MEDIA_UPLOAD_INVALID');
    });

    it('rejects oversized photos', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media/upload-url',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo', mime_type: 'image/jpeg', size_bytes: 10_485_761 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('MEDIA_UPLOAD_INVALID');
    });

    it('rejects malformed payloads', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media/upload-url',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /media (validation, before scope resolution)', () => {
    it('rejects a photo commit without object_key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo', event_id: EVENT_ID },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a video commit without video_url', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'video', event_id: EVENT_ID },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown fields (strict schemas)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo', object_key: 'tmp/x/y.jpg', source_url: 'https://evil.example/x.jpg', event_id: EVENT_ID },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a commit with neither event_id nor open_mic_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/media',
        headers: { authorization: 'Bearer token-a' },
        payload: { media_type: 'photo', object_key: 'tmp/a0000000-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000003.jpg' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('PATCH /media/{id} (immutables rejected by the strict schema)', () => {
    it('rejects media_type/source_url changes', async () => {
      for (const patch of [{ media_type: 'video' }, { source_url: 'https://x.example/y.jpg' }, { object_key: 'tmp/a/b.jpg' }, { video_url: 'https://youtu.be/dQw4w9WgXcQ' }]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/media/${MEDIA_ID}`,
          headers: { authorization: 'Bearer token-a' },
          payload: patch,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('PUT /open-mics/{id}/featured-media', () => {
    it('rejects malformed bodies', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/open-mics/${OPEN_MIC_ID}/featured-media`,
        headers: { authorization: 'Bearer token-a' },
        payload: { media_ids: ['not-a-uuid'] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /internal/media/{id}/renditions-complete', () => {
    it('rejects unsigned callbacks', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/internal/media/${MEDIA_ID}/renditions-complete`,
        headers: { 'content-type': 'text/plain' },
        payload: JSON.stringify({ width: 100, height: 100, renditions: {} }),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects callbacks with a wrong signature', async () => {
      const body = JSON.stringify({ width: 100, height: 100, renditions: {} });
      const response = await app.inject({
        method: 'POST',
        url: `/api/internal/media/${MEDIA_ID}/renditions-complete`,
        headers: { 'content-type': 'text/plain', 'x-media-renditions-signature': 'sha256=deadbeef' },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('plan capacity cap (no DB needed — input check before queries)', () => {
    it('rejects event creation with capacity above the plan maximum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/open-mics/${OPEN_MIC_ID}/events`,
        headers: { authorization: 'Bearer token-a' },
        payload: { title: 'Too Big', starts_at: '2026-12-15T19:00:00Z', ends_at: '2026-12-15T22:00:00Z', time_zone: 'Europe/Dublin', capacity: 51 },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('PLAN_LIMIT_EXCEEDED');
      expect(response.json().error.details).toEqual({ scope: 'event_capacity' });
    });

    it('rejects event creation with unlimited capacity under the default plan', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/open-mics/${OPEN_MIC_ID}/events`,
        headers: { authorization: 'Bearer token-a' },
        payload: { title: 'Unlimited', starts_at: '2026-12-15T19:00:00Z', ends_at: '2026-12-15T22:00:00Z', time_zone: 'Europe/Dublin' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('PLAN_LIMIT_EXCEEDED');
    });
  });
});
