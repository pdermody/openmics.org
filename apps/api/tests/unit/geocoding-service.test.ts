import { describe, expect, it, vi } from 'vitest';

import { GeocodingUnavailableError, RateLimitedError } from '../../src/errors.js';
import { createGeocodingService } from '../../src/geocoding/service.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('createGeocodingService', () => {
  it('throws GeocodingUnavailableError when no API key is configured', async () => {
    const service = createGeocodingService({ apiKey: '', baseUrl: 'https://example.invalid' });

    await expect(service.searchAddress('Dublin')).rejects.toBeInstanceOf(GeocodingUnavailableError);
  });

  it('maps LocationIQ search results to plain candidates', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ display_name: '1 Test St, Dublin, IE', lat: '53.35', lon: '-6.26' }]),
    );
    const service = createGeocodingService({ apiKey: 'test-key', baseUrl: 'https://example.invalid', fetchImpl });

    const candidates = await service.searchAddress('1 Test St Dublin');

    expect(candidates).toEqual([{ label: '1 Test St, Dublin, IE', lat: 53.35, lng: -6.26 }]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('key=test-key'));
  });

  it('returns null from reverse geocoding when LocationIQ finds nothing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Unable to geocode' }, 404));
    const service = createGeocodingService({ apiKey: 'test-key', baseUrl: 'https://example.invalid', fetchImpl });

    await expect(service.reverseGeocode(0, 0)).resolves.toBeNull();
  });

  it('translates a LocationIQ 429 into a RateLimitedError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Rate Limited Second' }, 429));
    const service = createGeocodingService({ apiKey: 'test-key', baseUrl: 'https://example.invalid', fetchImpl });

    await expect(service.searchAddress('Dublin')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('rejects immediately once the local queue depth is exceeded, without calling fetch', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(jsonResponse([]));
        }),
    );
    const service = createGeocodingService({
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid',
      fetchImpl,
      maxQueueDepth: 1,
    });

    const first = service.searchAddress('Dublin');
    await expect(service.searchAddress('Cork')).rejects.toBeInstanceOf(RateLimitedError);

    resolveFetch?.();
    await expect(first).resolves.toEqual([]);
  });

  it('throttles consecutive requests to no more than maxRequestsPerSecond', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const service = createGeocodingService({
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid',
      fetchImpl,
      maxRequestsPerSecond: 2,
    });

    const start = Date.now();
    await service.searchAddress('Dublin');
    await service.searchAddress('Cork');
    const elapsed = Date.now() - start;

    // Two requests at max 2/sec must be separated by at least ~500ms.
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });
});
