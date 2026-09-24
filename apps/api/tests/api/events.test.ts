import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const ACCOUNT_A = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };

describe('events routes', () => {
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

  it('rejects event creation without a bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      payload: { title: 'No Auth Event' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid event payload with a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      headers: { authorization: 'Bearer token-a' },
      payload: { time_zone: 'Europe/Dublin' }, // missing title and starts_at
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a partial location override (location snapshot violation)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      headers: { authorization: 'Bearer token-a' },
      payload: {
        title: 'Partial Location Event',
        starts_at: '2026-12-15T19:00:00Z',
        time_zone: 'Europe/Dublin',
        venue_name: 'Test Venue', // only venue, missing address/city/country/lat/lng
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects entry_fee_amount without currency', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      headers: { authorization: 'Bearer token-a' },
      payload: {
        title: 'Event with Entry Fee',
        starts_at: '2026-12-15T19:00:00Z',
        time_zone: 'Europe/Dublin',
        entry_fee_amount: 5, // requires entry_fee_currency
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects unknown fields on create', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/open-mics/00000000-0000-0000-0000-000000000000/events',
      headers: { authorization: 'Bearer token-a' },
      payload: {
        title: 'Event',
        starts_at: '2026-12-15T19:00:00Z',
        time_zone: 'Europe/Dublin',
        unexpected_field: 'nope',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
