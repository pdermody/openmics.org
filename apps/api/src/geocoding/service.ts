import { GeocodingUnavailableError, RateLimitedError } from '../errors.js';
import type { Pool } from 'pg';
import { withGeocodingCall, waitForGeocodingSlot } from './budget.js';

export type GeocodeCandidate = { label: string; lat: number; lng: number };

export type GeocodingServiceOptions = {
  apiKey: string;
  baseUrl: string;
  pool?: Pool;
  dailyLimit?: number;
  fetchImpl?: typeof fetch;
  maxRequestsPerSecond?: number;
  maxQueueDepth?: number;
};

export type GeocodingService = {
  searchAddress(query: string): Promise<GeocodeCandidate[]>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null>;
  searchCities?(query: string): Promise<ProviderCity[]>;
};

export type ProviderCity = {
  sourceId: string;
  city: string;
  cityAscii: string;
  country: string;
  countryAscii: string;
  iso2: string;
  iso3: string | null;
  adminName: string | null;
  lat: number;
  lng: number;
  population: null;
};

type LocationIqPlace = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  place_id?: unknown;
  osm_type?: unknown;
  osm_id?: unknown;
  class?: unknown;
  type?: unknown;
  address?: Record<string, unknown>;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toAscii(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x00-\x7F]/g, '');
}

export function parseProviderCities(body: unknown): ProviderCity[] {
  if (!Array.isArray(body)) throw new GeocodingUnavailableError('The city lookup provider returned an invalid response.');
  const cities: ProviderCity[] = [];
  const seen = new Set<string>();
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const place = raw as LocationIqPlace;
    const address = place.address;
    if (!address || typeof address !== 'object') continue;
    const city = asString(address.city) ?? asString(address.town) ?? asString(address.village) ?? asString(address.municipality);
    const country = asString(address.country);
    const iso2 = asString(address.country_code)?.toUpperCase();
    const type = asString(place.type)?.toLowerCase();
    const acceptedTypes = new Set(['city', 'town', 'municipality']);
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    const sourceId = place.osm_type && place.osm_id
      ? `${String(place.osm_type)}:${String(place.osm_id)}`
      : place.place_id === undefined ? null : String(place.place_id);
    if (!city || !country || !iso2 || !/^[A-Z]{2}$/.test(iso2) || !type || !acceptedTypes.has(type)
      || !sourceId || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) continue;
    const key = `${iso2}:${city.toLocaleLowerCase()}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const iso3 = asString(address['ISO3166-2-lvl4']);
    cities.push({
      sourceId,
      city,
      cityAscii: toAscii(city),
      country,
      countryAscii: toAscii(country),
      iso2,
      iso3: iso3 && /^[A-Za-z]{3}$/.test(iso3) ? iso3.toUpperCase() : null,
      adminName: asString(address.state) ?? asString(address.region),
      lat,
      lng,
      population: null,
    });
  }
  return cities;
}

function parseAddressCandidate(place: LocationIqPlace): GeocodeCandidate {
  const label = asString(place.display_name);
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!label || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new GeocodingUnavailableError('The geocoding provider returned an invalid response.');
  }
  return { label, lat, lng };
}

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
  const { apiKey, baseUrl, pool, dailyLimit = 0, fetchImpl = fetch, maxRequestsPerSecond = 2, maxQueueDepth = 10 } = options;
  const minIntervalMs = 1000 / maxRequestsPerSecond;
  let lastRequestAt = 0;
  let queueDepth = 0;
  if (dailyLimit > 0 && !pool) throw new GeocodingUnavailableError('A shared database is required for the configured geocoding budget.');

  async function throttledFetch(url: string): Promise<Response> {
    if (queueDepth >= maxQueueDepth) {
      throw new RateLimitedError('Too many geocoding requests right now. Please try again shortly.');
    }
    queueDepth++;
    try {
      const makeRequest = async () => {
        lastRequestAt = Date.now();
        let response: Response;
        try {
          response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') {
            throw new GeocodingUnavailableError('The geocoding provider request timed out.');
          }
          throw error;
        }
        if (response.status === 429) {
          throw new RateLimitedError('The geocoding provider is rate-limiting requests. Please try again shortly.');
        }
        return response;
      };
      if (pool && dailyLimit > 0) return await withGeocodingCall(pool, dailyLimit, makeRequest);
      const waitMs = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
      await waitForGeocodingSlot(waitMs);
      return await makeRequest();
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
      if (!Array.isArray(body)) throw new GeocodingUnavailableError('The geocoding provider returned an invalid response.');
      return body.map((item) => parseAddressCandidate(item));
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
      return parseAddressCandidate(body);
    },

    async searchCities(query: string): Promise<ProviderCity[]> {
      requireApiKey();
      if (dailyLimit <= 0) throw new GeocodingUnavailableError('External city search is disabled.');
      const url = `${baseUrl}/v1/autocomplete?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&format=json&limit=10&layers=city&tag=!place:village&dedupe=1`;
      const response = await throttledFetch(url);
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`LocationIQ city search failed with status ${response.status}`);
      }
      return parseProviderCities(await response.json());
    },
  };
}
