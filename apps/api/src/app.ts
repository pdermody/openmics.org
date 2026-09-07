import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { registerAuth } from './auth/plugin.js';
import type { AuthVerifier } from './auth/types.js';
import { createAccountLookupVerifier } from './auth/verifier.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPool } from './db.js';
import { registerErrorHandler } from './errors.js';
import { checkHandleAvailability } from './handles/repository.js';
import { handlesRoutes, type HandlesPluginOptions } from './handles/routes.js';
import { eventsRoutes } from './events/routes.js';
import { openMicsRoutes } from './open-mics/routes.js';
import { profilesRoutes } from './profiles/routes.js';
import { registrationsRoutes } from './registrations/routes.js';
import { performancesRoutes } from './performances/routes.js';
import { spaRoutes } from './spa-routes.js';
import { accountsRoutes } from './accounts/routes.js';

export type BuildAppOptions = {
  config?: AppConfig;
  logger?: boolean;
  db?: Pool;
  handles?: HandlesPluginOptions;
  authVerifier?: AuthVerifier;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? config.environment !== 'test' });

  const pool = options.db ?? createPool(config);
  if (!options.db) app.addHook('onClose', async () => pool.end());

  registerErrorHandler(app);
  registerAuth(app, options.authVerifier ?? createAccountLookupVerifier(pool));

  const handlesOptions: HandlesPluginOptions =
    options.handles ?? { checkAvailability: (candidate) => checkHandleAvailability(pool, candidate) };

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(handlesRoutes, { ...handlesOptions, prefix: '/api' });
  app.register(profilesRoutes, { pool, prefix: '/api' });
  app.register(openMicsRoutes, { pool, prefix: '/api' });
  app.register(eventsRoutes, { pool, prefix: '/api' });
  app.register(registrationsRoutes, { pool, prefix: '/api' });
  app.register(performancesRoutes, { pool, prefix: '/api' });
  app.register(accountsRoutes, { pool, prefix: '/api' });
  app.register(spaRoutes);

  return app;
}