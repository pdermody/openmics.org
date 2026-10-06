import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';

import { CityCatalogueImportRequiredError, NotFoundError, ValidationError } from '../errors.js';
import { loadCityCatalogue, type CityCatalogue, type CitySearchEntry } from './catalogue.js';
import {
  findCityById,
  findCityIdsBySourceIds,
  findDiscoverySuggestions,
  serializeCity,
} from './repository.js';
import { compareResolvedCityCandidates, selectCitySearchCandidates } from './search.js';

export type CitiesPluginOptions = { pool: Pool; catalogue?: CityCatalogue };

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
}).strict();

const suggestionsQuerySchema = z.object({
  near: z.string().regex(/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/),
  radius_km: z.coerce.number().finite().min(0).max(200).default(50),
  city_id: z.string().uuid().optional(),
}).strict();

export const citiesRoutes: FastifyPluginAsync<CitiesPluginOptions> = async (app, { pool, catalogue: injectedCatalogue }) => {
  const catalogue = injectedCatalogue ?? await loadCityCatalogue();
  app.get<{ Querystring: { q?: string; country?: string } }>('/cities/search', async (request) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid city search query', parsed.error.flatten());
    const candidates = selectCitySearchCandidates(catalogue, parsed.data.q, parsed.data.country);
    const cityIds = await findCityIdsBySourceIds(pool, candidates.map((city) => city.source_id));
    const missing = candidates.filter((city) => !cityIds.has(city.source_id)).map((city) => city.source_id);
    if (missing.length) throw new CityCatalogueImportRequiredError(missing);
    return {
      items: candidates
        .sort((left, right) => compareResolvedCityCandidates(left, right, parsed.data.q, cityIds))
        .slice(0, 10)
        .map((city) => serializeSearchCity(city, cityIds.get(city.source_id)!)),
    };
  });

  app.get<{ Params: { id: string } }>('/cities/:id', async (request) => {
    if (!z.string().uuid().safeParse(request.params.id).success) throw new ValidationError('id must be a UUID');
    const city = await findCityById(pool, request.params.id);
    if (!city) throw new NotFoundError('City not found');
    return serializeCity(city);
  });

  app.get<{ Querystring: { near?: string; radius_km?: string; city_id?: string } }>('/discovery/suggestions', async (request) => {
    const parsed = suggestionsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid discovery suggestions query', parsed.error.flatten());
    const [latText, lngText] = parsed.data.near.split(',');
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new ValidationError('near must contain valid latitude and longitude');
    }
    return findDiscoverySuggestions(pool, { lat, lng, radiusKm: parsed.data.radius_km, cityId: parsed.data.city_id });
  });
};

function serializeSearchCity(city: CitySearchEntry, id: string) {
  return {
    id,
    city: city.city,
    city_ascii: city.city_ascii,
    country: city.country,
    country_ascii: city.country_ascii,
    iso2: city.iso2,
    iso3: city.iso3,
    admin_name: city.admin_name,
    lat: city.lat,
    lng: city.lng,
    population: city.population,
    retired: city.retired,
  };
}
