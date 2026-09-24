import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const ACCOUNT = { accountId: '10000000-0000-4000-8000-000000000001', isPlatformAdmin: false };

describe('performance routes', () => {
  const app = buildApp({
    config: { databaseUrl: 'postgres://unused', environment: 'test', host: '127.0.0.1', port: 3000 },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }), resolveHandle: async () => null },
    authVerifier: vi.fn(async (token: string) => (token === 'owner-token' ? ACCOUNT : null)),
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('requires authentication for performance creation', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/performances', payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('rejects invalid performance payloads before database access', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/performances',
      headers: { authorization: 'Bearer owner-token' },
      payload: { registration_id: '10000000-0000-4000-8000-000000000001', name: 'Song', status: 'planned' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
