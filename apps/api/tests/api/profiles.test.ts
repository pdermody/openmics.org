import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const ACCOUNT_A = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };
const ACCOUNT_B = { accountId: 'b0000000-0000-0000-0000-000000000002', isPlatformAdmin: false };

describe('profiles routes', () => {
  const authVerifier = vi.fn(async (token: string) => (token === 'token-a' ? ACCOUNT_A : token === 'token-b' ? ACCOUNT_B : null));

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

  it('rejects profile creation without a bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { profile_name: 'No Auth', profile_kind: 'performer' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid profile payload with a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: 'Bearer token-a' },
      payload: { profile_kind: 'performer' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a handle field on update rather than silently ignoring it', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/profiles/00000000-0000-0000-0000-000000000000',
      headers: { authorization: 'Bearer token-a' },
      payload: { handle: 'new-handle' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects profile_kind on update because kind is immutable', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/profiles/00000000-0000-0000-0000-000000000000',
      headers: { authorization: 'Bearer token-a' },
      payload: { profile_kind: 'organizer' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a handle on organizer profile creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: 'Bearer token-a' },
      payload: { profile_name: 'Paul Dermody', profile_kind: 'organizer', handle: 'paul-dermody' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
