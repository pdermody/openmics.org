import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';

import { NotFoundError, ValidationError } from '../errors.js';
import type { GeocodingService } from '../geocoding/service.js';
import {
  findCityById,
  findDiscoverySuggestions,
  searchCities,
  serializeCity,
} from './repository.js';
import { searchExternalCities } from './service.js';

export type CitiesPluginOptions = { pool: Pool; geocoding: GeocodingService };

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
}).strict();

const externalSearchSchema = z.object({ q: z.string().trim().min(2).max(100) }).strict();
const suggestionsQuerySchema = z.object({
  near: z.string().regex(/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/),
  radius_km: z.coerce.number().finite().min(0).max(200).default(50),
  city_id: z.string().uuid().optional(),
}).strict();

export const citiesRoutes: FastifyPluginAsync<CitiesPluginOptions> = async (app, { pool, geocoding }) => {
  app.get<{ Querystring: { q?: string; country?: string } }>('/cities/search', async (request) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid city search query', parsed.error.flatten());
    const rows = await searchCities(pool, parsed.data.q, parsed.data.country);
    return { items: rows.map(serializeCity) };
  });

  app.get<{ Params: { id: string } }>('/cities/:id', async (request) => {
    if (!z.string().uuid().safeParse(request.params.id).success) throw new ValidationError('id must be a UUID');
    const city = await findCityById(pool, request.params.id);
    if (!city) throw new NotFoundError('City not found');
    return serializeCity(city);
  });

  app.post('/cities/search-external', async (request) => {
    const parsed = externalSearchSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid external city search payload', parsed.error.flatten());
    return searchExternalCities(pool, geocoding, parsed.data.q);
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
