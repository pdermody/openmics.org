import type { FastifyPluginAsync } from 'fastify';

import { isValidHandleFormat } from './validation.js';
import type { HandleAvailability } from './repository.js';

export type HandlesPluginOptions = {
  checkAvailability: (candidate: string) => Promise<HandleAvailability>;
};

export const handlesRoutes: FastifyPluginAsync<HandlesPluginOptions> = async (app, { checkAvailability }) => {
  app.get<{ Params: { candidate: string } }>('/handles/check/:candidate', async (request) => {
    const { candidate } = request.params;

    if (!isValidHandleFormat(candidate)) {
      return { available: false, reason: 'invalid_format' };
    }

    return checkAvailability(candidate);
  });
};
