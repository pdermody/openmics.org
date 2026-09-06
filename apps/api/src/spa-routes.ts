import type { FastifyPluginAsync } from 'fastify';

export type SpaRoutesOptions = {
  entryPoint?: string;
};

const DEFAULT_ENTRY_POINT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Mic</title></head><body><div id="root"></div></body></html>';

export const spaRoutes: FastifyPluginAsync<SpaRoutesOptions> = async (app, options) => {
  const entryPoint = options.entryPoint ?? DEFAULT_ENTRY_POINT;

  app.get('/*', async (request, reply) => {
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      return;
    }
    reply.type('text/html; charset=utf-8').send(entryPoint);
  });
};

export { DEFAULT_ENTRY_POINT };
