import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { registerAuth } from './auth/plugin.js';
import type { AuthVerifier } from './auth/types.js';
import { createAccountLookupVerifier } from './auth/verifier.js';
import { createCognitoVerifier } from './auth/cognito-verifier.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPool } from './db.js';
import { createEmailAdapter, type EmailAdapter } from './email/index.js';
import { registerErrorHandler } from './errors.js';
import { checkHandleAvailability, resolveCurrentHandle } from './handles/repository.js';
import { handlesRoutes, type HandlesPluginOptions } from './handles/routes.js';
import { createGeocodingService } from './geocoding/service.js';
import { geocodingRoutes, type GeocodingPluginOptions } from './geocoding/routes.js';
import { citiesRoutes } from './cities/routes.js';
import { createMediaConsentHooks } from './media/consent.js';
import {
  createMediaStorageAdapter,
  createRenditionsQueueAdapter,
  type MediaStorageAdapter,
  type RenditionsQueueAdapter,
} from './media/index.js';
import { mediaRoutes } from './media/routes.js';
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
  geocoding?: GeocodingPluginOptions;
  authVerifier?: AuthVerifier;
  emailAdapter?: EmailAdapter;
  mediaStorage?: MediaStorageAdapter;
  renditionsQueue?: RenditionsQueueAdapter;
};

// Real Cognito verification is only used once a user pool and app client are actually
// configured (staging/production, or a developer testing real sign-in locally). Automated
// tests never call AWS and virtually always inject their own `authVerifier` regardless.
export function createDefaultAuthVerifier(
  pool: Pool,
  config: AppConfig,
  deps: { createCognitoVerifier: typeof createCognitoVerifier } = { createCognitoVerifier },
): AuthVerifier {
  const cognitoVerifier = config.cognitoUserPoolId && config.cognitoClientId
    ? deps.createCognitoVerifier(pool, {
        region: config.awsRegion,
        userPoolId: config.cognitoUserPoolId,
        clientId: config.cognitoClientId,
      })
    : null;

  // The interim lookup verifier treats the bearer token as `accounts.cognito_id` directly; it
  // backs both the general dev/test fallback and the local simulated-auth profile switcher
  // (its seeded tokens, e.g. "dev-owner", are exactly a `cognito_id`).
  const lookupVerifier = createAccountLookupVerifier(pool);

  if (!cognitoVerifier) {
    if (config.environment === 'production') {
      throw new Error('Cognito user-pool and app-client configuration is required in production');
    }
    return lookupVerifier;
  }
  if (config.environment !== 'development' || !config.simulatedAuthMode) return cognitoVerifier;

  // Both a real user pool and local simulated auth are configured at once (developer testing
  // real Cognito sign-in without giving up the profile switcher). Real Cognito ID tokens are
  // JWTs (three dot-separated segments); simulated tokens are plain seeded cognito_id strings
  // and never contain a dot. Route by shape so neither mechanism can be confused for the other.
  return async (token) => {
    if (token.split('.').length === 3) return cognitoVerifier(token);
    return lookupVerifier(token);
  };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = { ...loadConfig(), ...options.config };
  const app = Fastify({ logger: options.logger ?? config.environment !== 'test' });
  const emailAdapter = options.emailAdapter ?? createEmailAdapter(config);
  const mediaStorage = options.mediaStorage ?? createMediaStorageAdapter(config);
  const renditionsQueue = options.renditionsQueue ?? createRenditionsQueueAdapter(config);
  const mediaConsent = createMediaConsentHooks({
    bucket: config.mediaBucket ?? 'local',
    cdnBaseUrl: config.mediaCdnBaseUrl,
  });

  const pool = options.db ?? createPool(config);
  if (!options.db) app.addHook('onClose', async () => pool.end());

  registerErrorHandler(app);
  registerAuth(app, options.authVerifier ?? createDefaultAuthVerifier(pool, config));

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
    options.handles ?? {
      checkAvailability: (candidate) => checkHandleAvailability(pool, candidate),
      resolveHandle: (handle) => resolveCurrentHandle(pool, handle),
    };
  const geocodingOptions: GeocodingPluginOptions =
    options.geocoding ?? {
      service: createGeocodingService({
        apiKey: config.locationIqApiKey,
        baseUrl: config.locationIqBaseUrl,
        pool,
        dailyLimit: config.geocodingDailyLimit,
      }),
    };

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(handlesRoutes, { ...handlesOptions, prefix: '/api' });
  app.register(geocodingRoutes, { ...geocodingOptions, prefix: '/api' });
  app.register(citiesRoutes, { pool, geocoding: geocodingOptions.service, prefix: '/api' });
  app.register(profilesRoutes, { pool, prefix: '/api' });
  app.register(openMicsRoutes, { pool, prefix: '/api' });
  app.register(eventsRoutes, { pool, streamTokenSecret: config.streamTokenSecret, prefix: '/api' });
  app.register(registrationsRoutes, { pool, emailAdapter, appBaseUrl: config.appBaseUrl, streamTokenSecret: config.streamTokenSecret, mediaConsent, prefix: '/api' });
  app.register(performancesRoutes, { pool, prefix: '/api' });
  app.register(accountsRoutes, { pool, prefix: '/api' });
  app.register(mediaRoutes, { pool, config, storage: mediaStorage, renditionsQueue, prefix: '/api' });
  app.register(spaRoutes, { pool, config });

  return app;
}