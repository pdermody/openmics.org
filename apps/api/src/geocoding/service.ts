import { GeocodingUnavailableError, RateLimitedError } from '../errors.js';

export type GeocodeCandidate = { label: string; lat: number; lng: number };

export type GeocodingServiceOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maxRequestsPerSecond?: number;
  maxQueueDepth?: number;
};

export type GeocodingService = {
  searchAddress(query: string): Promise<GeocodeCandidate[]>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null>;
};

type LocationIqPlace = { display_name: string; lat: string; lon: string };

/**
 * Thin server-side proxy over LocationIQ's forward/reverse geocoding endpoints.
 *
 * The API key is held here, never sent to the browser. LocationIQ's free tier caps
 * usage at ~2 requests/second *for the whole account*, shared across every concurrent
 * user of this app - so requests are throttled locally (not just per-user debounced on
 * the client) to avoid the whole app getting rate-limited by a burst of simultaneous
 * editors. When the local queue is saturated, or LocationIQ itself returns 429, a
 * RateLimitedError is thrown so callers can distinguish "back off" from a hard failure.
 */
export function createGeocodingService(options: GeocodingServiceOptions): GeocodingService {
  const { apiKey, baseUrl, fetchImpl = fetch, maxRequestsPerSecond = 2, maxQueueDepth = 10 } = options;
  const minIntervalMs = 1000 / maxRequestsPerSecond;
  let lastRequestAt = 0;
  let queueDepth = 0;

  async function throttledFetch(url: string): Promise<Response> {
    if (queueDepth >= maxQueueDepth) {
      throw new RateLimitedError('Too many geocoding requests right now. Please try again shortly.');
    }
    queueDepth++;
    try {
      const waitMs = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      const response = await fetchImpl(url);
      if (response.status === 429) {
        throw new RateLimitedError('The geocoding provider is rate-limiting requests. Please try again shortly.');
      }
      return response;
    } finally {
      queueDepth--;
    }
  }

  function requireApiKey(): void {
    if (!apiKey) throw new GeocodingUnavailableError();
  }

  return {
    async searchAddress(query: string): Promise<GeocodeCandidate[]> {
      requireApiKey();
      const url = `${baseUrl}/v1/search?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&format=json&limit=5`;
      const response = await throttledFetch(url);
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`LocationIQ search failed with status ${response.status}`);
      }
      const body = (await response.json()) as LocationIqPlace[];
      return body.map((item) => ({ label: item.display_name, lat: Number(item.lat), lng: Number(item.lon) }));
    },

    async reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null> {
      requireApiKey();
      const url = `${baseUrl}/v1/reverse?key=${encodeURIComponent(apiKey)}&lat=${lat}&lon=${lng}&format=json`;
      const response = await throttledFetch(url);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`LocationIQ reverse geocode failed with status ${response.status}`);
      }
      const body = (await response.json()) as LocationIqPlace;
      return { label: body.display_name, lat: Number(body.lat), lng: Number(body.lon) };
    },
  };
}
