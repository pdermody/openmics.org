import { ValidationError } from './errors.js';

export type GeoFilter = { lat: number; lng: number; radiusKm: number };

export function parseGeoFilter(near?: string, radius?: string): GeoFilter | undefined {
  if (!near) {
    if (radius !== undefined) throw new ValidationError('radius_km requires near');
    return undefined;
  }
  const match = near.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) throw new ValidationError('near must be formatted as lat,lng');
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const radiusKm = radius === undefined ? 25 : Number(radius);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ValidationError('near contains invalid coordinates');
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 0) throw new ValidationError('radius_km must be a non-negative number');
  return { lat, lng, radiusKm };
}
