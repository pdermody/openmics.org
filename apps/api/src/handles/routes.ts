import type { FastifyPluginAsync } from 'fastify';

import { NotFoundError } from '../errors.js';
import { isValidHandleFormat } from './validation.js';
import type { HandleAvailability, HandleResolution } from './repository.js';

export type HandlesPluginOptions = {
  checkAvailability: (candidate: string) => Promise<HandleAvailability>;
  resolveHandle: (handle: string) => Promise<HandleResolution | null>;
};

export const handlesRoutes: FastifyPluginAsync<HandlesPluginOptions> = async (app, { checkAvailability, resolveHandle }) => {
  app.get<{ Params: { candidate: string } }>('/handles/check/:candidate', async (request) => {
    const { candidate } = request.params;

    if (!isValidHandleFormat(candidate)) {
      return { available: false, reason: 'invalid_format' };
    }

    return checkAvailability(candidate);
  });

  // Public resolver: given a handle, reports which entity type/id it currently belongs to (see
  // docs/6-open-mic-vanity-urls.md §10). Callers then fetch the entity itself by that real id.
  app.get<{ Params: { handle: string } }>('/handles/:handle', async (request) => {
    const resolution = await resolveHandle(request.params.handle);
    if (!resolution) throw new NotFoundError('Handle not found');
    return { type: resolution.entityType, id: resolution.profileId ?? resolution.openMicId };
  });
};
