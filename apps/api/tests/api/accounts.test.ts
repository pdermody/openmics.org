import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('account context routes', () => {
  const app = buildApp({
    config: { databaseUrl: 'postgres://unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }), resolveHandle: async () => null },
    authVerifier: vi.fn(async (token: string) => token === 'local-account' ? { accountId: '10000000-0000-4000-8000-000000000001', isPlatformAdmin: false } : null),
  });
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('protects account context endpoints', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
  });
});
