import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const ACCOUNT_A = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };

describe('open-mics routes', () => {
  const authVerifier = vi.fn(async (token: string) => (token === 'token-a' ? ACCOUNT_A : null));

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

  it('rejects open mic creation without a bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      payload: { name: 'No Auth Open Mic' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid open mic payload with a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer token-a', 'x-current-profile': '00000000-0000-0000-0000-000000000000' },
      payload: { name: 'Missing Required Fields' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown fields on create rather than silently ignoring them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics',
      headers: { authorization: 'Bearer token-a', 'x-current-profile': '00000000-0000-0000-0000-000000000000' },
      payload: {
        name: 'Extra Field Open Mic',
        venue_name: 'Venue',
        address_line1: '1 Test St',
        city: 'Dublin',
        country: 'IE',
        time_zone: 'Europe/Dublin',
        activities: ['singing'],
        unexpected_field: 'nope',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a handle field on update rather than silently ignoring it', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000',
      headers: { authorization: 'Bearer token-a' },
      payload: { handle: 'new-handle' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
