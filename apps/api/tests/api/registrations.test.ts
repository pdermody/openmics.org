import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const ACCOUNT = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };

describe('registration routes', () => {
  const authVerifier = vi.fn(async (token: string) => (token === 'token-a' ? ACCOUNT : null));
  const app = buildApp({
    config: {
      databaseUrl: 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_test',
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
    },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }), resolveHandle: async () => null },
    authVerifier,
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it('rejects invalid registration payloads before database access', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/events/00000000-0000-0000-0000-000000000000/registrations',
      payload: { performer_name: 'Guest', submission_channel: 'organic', organizer_supervised: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication for claim routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/registrations/00000000-0000-0000-0000-000000000000/claim',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });
});
