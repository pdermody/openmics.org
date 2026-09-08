import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { registerAuth } from './auth/plugin.js';
import type { AuthVerifier } from './auth/types.js';
import { createAccountLookupVerifier } from './auth/verifier.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPool } from './db.js';
import { createEmailAdapter, type EmailAdapter } from './email/index.js';
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
  config?: Partial<AppConfig>;
  logger?: boolean;
  db?: Pool;
  handles?: HandlesPluginOptions;
  authVerifier?: AuthVerifier;
  emailAdapter?: EmailAdapter;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = { ...loadConfig(), ...options.config };
  const app = Fastify({ logger: options.logger ?? config.environment !== 'test' });
  const emailAdapter = options.emailAdapter ?? createEmailAdapter(config);

  const pool = options.db ?? createPool(config);
  if (!options.db) app.addHook('onClose', async () => pool.end());

  registerErrorHandler(app);
  registerAuth(app, options.authVerifier ?? createAccountLookupVerifier(pool));

  if (config.environment === 'development' && config.simulatedAuthMode) {
    app.get('/api/dev/simulated-auth/config', async () => {
      const result = await pool.query<{ account_id: string; cognito_id: string; display_name: string; profile_id: string; profile_name: string; profile_kind: string }>(`
        SELECT a.id as account_id, a.cognito_id, a.display_name, p.id as profile_id, p.profile_name, p.profile_kind
        FROM accounts a
        JOIN profiles p ON p.created_by_account_id = a.id AND p.deleted_at IS NULL
        WHERE a.cognito_id IN ('dev-owner', 'dev-organizer-2', 'dev-organizer-3', 'dev-performer', 'dev-performer-2')
        ORDER BY CASE p.profile_kind WHEN 'organizer' THEN 1 ELSE 2 END, p.profile_name
      `);

      return {
        enabled: true,
        roles: result.rows.map((row) => ({
          id: row.profile_id,
          label: `${row.profile_name} · ${row.profile_kind}`,
          kind: row.profile_kind,
          accountId: row.account_id,
          profileId: row.profile_id,
          profileName: row.profile_name,
          accountDisplayName: row.display_name,
          token: row.cognito_id,
        })),
      };
    });
  }

  const handlesOptions: HandlesPluginOptions =
    options.handles ?? { checkAvailability: (candidate) => checkHandleAvailability(pool, candidate) };

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(handlesRoutes, { ...handlesOptions, prefix: '/api' });
  app.register(profilesRoutes, { pool, prefix: '/api' });
  app.register(openMicsRoutes, { pool, prefix: '/api' });
  app.register(eventsRoutes, { pool, prefix: '/api' });
  app.register(registrationsRoutes, { pool, emailAdapter, appBaseUrl: config.appBaseUrl, prefix: '/api' });
  app.register(performancesRoutes, { pool, prefix: '/api' });
  app.register(accountsRoutes, { pool, prefix: '/api' });
  app.register(spaRoutes);

  return app;
}