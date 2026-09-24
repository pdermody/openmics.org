import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('GET /api/handles/:handle', () => {
  const resolveHandle = vi.fn(async (handle: string) =>
    handle === 'known-open-mic' ? { entityType: 'open_mic' as const, profileId: null, openMicId: 'open-mic-1' } : null,
  );

  const app = buildApp({
    config: {
      databaseUrl: 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_test',
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
    },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }), resolveHandle },
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('resolves a known handle to its entity type and id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/handles/known-open-mic' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ type: 'open_mic', id: 'open-mic-1' });
    expect(resolveHandle).toHaveBeenCalledWith('known-open-mic');
  });

  it('returns 404 for an unknown handle', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/handles/never-seen-handle' });

    expect(response.statusCode).toBe(404);
  });
});
