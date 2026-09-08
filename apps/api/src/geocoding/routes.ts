import type { FastifyPluginAsync } from 'fastify';

import { ValidationError } from '../errors.js';
import type { GeocodingService } from './service.js';

export type GeocodingPluginOptions = { service: GeocodingService };

export const geocodingRoutes: FastifyPluginAsync<GeocodingPluginOptions> = async (app, { service }) => {
  app.get<{ Querystring: { q?: string } }>('/geocoding/search', { preHandler: app.authenticate }, async (request) => {
    const q = request.query.q?.trim();
    if (!q) throw new ValidationError('q is required');

    const candidates = await service.searchAddress(q);
    return { candidates };
  });

  app.get<{ Querystring: { lat?: string; lng?: string } }>('/geocoding/reverse', { preHandler: app.authenticate }, async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new ValidationError('lat must be a number between -90 and 90');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new ValidationError('lng must be a number between -180 and 180');

    const candidate = await service.reverseGeocode(lat, lng);
    return { candidate };
  });
};
