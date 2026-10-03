import { describe, expect, it, vi } from 'vitest';

import { createDefaultAuthVerifier } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';

const baseConfig: AppConfig = {
  databaseUrl: 'postgres://unused',
  environment: 'development',
  host: '127.0.0.1',
  port: 3000,
  simulatedAuthMode: false,
  emailAdapter: 'console',
  emailSenderAddress: 'noreply@openmics.org',
  awsRegion: 'eu-west-1',
  appBaseUrl: 'http://localhost:5173',
  locationIqApiKey: '',
  locationIqBaseUrl: 'https://us1.locationiq.com',
  streamTokenSecret: 'test-stream-token-secret',
  mediaStorageAdapter: 'local',
  mediaCdnBaseUrl: 'https://media.test',
  mediaPresignExpirySeconds: 900,
  spaIndexHtmlPath: '/nonexistent/index.html',
};

function fakePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as never;
}

describe('createDefaultAuthVerifier', () => {
  it('falls back to the account-lookup verifier when Cognito is not configured', async () => {
    const pool = fakePool();
    const cognitoVerifierFactory = vi.fn();
    const verifier = createDefaultAuthVerifier(pool, baseConfig, { createCognitoVerifier: cognitoVerifierFactory });

    expect(cognitoVerifierFactory).not.toHaveBeenCalled();
    // createAccountLookupVerifier queries the DB; we only care that Cognito wasn't constructed here.
    void verifier;
  });

  it('uses the Cognito verifier exclusively outside development (staging/production)', async () => {
    const pool = fakePool();
    const fakeCognitoVerifier = vi.fn(async () => ({ accountId: 'cognito-account', isPlatformAdmin: false }));
    const cognitoVerifierFactory = vi.fn(() => fakeCognitoVerifier);
    const config: AppConfig = { ...baseConfig, environment: 'production', cognitoUserPoolId: 'pool', cognitoClientId: 'client' };

    const verifier = createDefaultAuthVerifier(pool, config, { createCognitoVerifier: cognitoVerifierFactory });
    const result = await verifier('not-a-jwt-shaped-token');

    expect(result).toEqual({ accountId: 'cognito-account', isPlatformAdmin: false });
    expect(fakeCognitoVerifier).toHaveBeenCalledWith('not-a-jwt-shaped-token');
  });

  it('fails closed when production Cognito configuration is missing', () => {
    const pool = fakePool();
    expect(() => createDefaultAuthVerifier(pool, { ...baseConfig, environment: 'production' })).toThrow(
      'Cognito user-pool and app-client configuration is required in production',
    );
  });

  it('routes JWT-shaped tokens to Cognito and plain tokens to the lookup verifier when simulated auth is also enabled', async () => {
    const pool = fakePool();
    const fakeCognitoVerifier = vi.fn(async () => ({ accountId: 'cognito-account', isPlatformAdmin: false }));
    const cognitoVerifierFactory = vi.fn(() => fakeCognitoVerifier);
    const config: AppConfig = {
      ...baseConfig,
      environment: 'development',
      simulatedAuthMode: true,
      cognitoUserPoolId: 'pool',
      cognitoClientId: 'client',
    };

    const verifier = createDefaultAuthVerifier(pool, config, { createCognitoVerifier: cognitoVerifierFactory });

    const jwtShaped = 'header.payload.signature';
    const result = await verifier(jwtShaped);
    expect(fakeCognitoVerifier).toHaveBeenCalledWith(jwtShaped);
    expect(result).toEqual({ accountId: 'cognito-account', isPlatformAdmin: false });

    // A plain simulated token (e.g. seeded "dev-owner") has no dots and must never reach Cognito.
    fakeCognitoVerifier.mockClear();
    await verifier('dev-owner');
    expect(fakeCognitoVerifier).not.toHaveBeenCalled();
  });

  it('does not enable simulated plain-token lookup outside development', async () => {
    const pool = fakePool();
    const fakeCognitoVerifier = vi.fn(async () => ({ accountId: 'cognito-account', isPlatformAdmin: false }));
    const cognitoVerifierFactory = vi.fn(() => fakeCognitoVerifier);
    const config: AppConfig = {
      ...baseConfig,
      environment: 'test',
      simulatedAuthMode: true,
      cognitoUserPoolId: 'pool',
      cognitoClientId: 'client',
    };

    const verifier = createDefaultAuthVerifier(pool, config, { createCognitoVerifier: cognitoVerifierFactory });
    await verifier('dev-owner');

    expect(fakeCognitoVerifier).toHaveBeenCalledWith('dev-owner');
  });
});
