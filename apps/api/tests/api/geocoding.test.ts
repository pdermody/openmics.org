import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { RateLimitedError } from '../../src/errors.js';
import type { GeocodeCandidate } from '../../src/geocoding/service.js';

const ACCOUNT_A = { accountId: 'a0000000-0000-0000-0000-000000000001', isPlatformAdmin: false };

describe('geocoding routes', () => {
  const searchAddress = vi.fn(async (query: string): Promise<GeocodeCandidate[]> =>
    query === 'rate-limit-me' ? Promise.reject(new RateLimitedError()) : [{ label: '1 Test St, Dublin, IE', lat: 53.35, lng: -6.26 }],
  );
  const reverseGeocode = vi.fn(async (lat: number): Promise<GeocodeCandidate | null> =>
    lat === 0 ? null : { label: '1 Test St, Dublin, IE', lat, lng: -6.26 },
  );
  const authVerifier = vi.fn(async (token: string) => (token === 'token-a' ? ACCOUNT_A : null));

  const app = buildApp({
    config: {
      databaseUrl: '******127.0.0.1:5432/openmic_test',
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
    },
    logger: false,
    handles: { checkAvailability: async () => ({ available: true }) },
    geocoding: { service: { searchAddress, reverseGeocode } },
    authVerifier,
  });

  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  const authHeader = { authorization: ['Bearer', 'token-a'].join(' ') }

  it('rejects a search request without a bearer token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/geocoding/search?q=Dublin' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a search request with a missing query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/search',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(searchAddress).not.toHaveBeenCalled();
  });

  it('returns candidates for a well-formed search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/search?q=1+Test+St+Dublin',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ candidates: [{ label: '1 Test St, Dublin, IE', lat: 53.35, lng: -6.26 }] });
  });

  it('surfaces a rate-limited response with the GEOCODING_RATE_LIMITED code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/search?q=rate-limit-me',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('GEOCODING_RATE_LIMITED');
  });

  it('rejects a reverse geocode request with out-of-range coordinates', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/reverse?lat=200&lng=0',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('returns a candidate for a well-formed reverse geocode request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/reverse?lat=53.35&lng=-6.26',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ candidate: { label: '1 Test St, Dublin, IE', lat: 53.35, lng: -6.26 } });
  });

  it('returns a null candidate when nothing is found', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/geocoding/reverse?lat=0&lng=0',
      headers: authHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ candidate: null });
  });
});
