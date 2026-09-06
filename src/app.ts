import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig, type AppConfig } from './config.js';

export type BuildAppOptions = {
  config?: AppConfig;
  logger?: boolean;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? config.environment !== 'test' });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}