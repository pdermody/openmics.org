import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createCognitoVerifier } from '../../src/auth/cognito-verifier.js';

const REGION = 'eu-west-1';
const USER_POOL_ID = 'eu-west-1_testPool';
const CLIENT_ID = 'test-client-id';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

type FakePool = { query: ReturnType<typeof vi.fn> };

function fakePool(rows: Array<{ id: string; is_platform_admin: boolean }>): FakePool {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('createCognitoVerifier', () => {
  let privateKey: CryptoKey;
  let getKey: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const { publicKey, privateKey: generatedPrivateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    privateKey = generatedPrivateKey;
    const jwk = await exportJWK(publicKey);
    getKey = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  });

  async function signToken(
    claims: Record<string, unknown>,
    overrides: { issuer?: string; expiresIn?: string } = {},
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? ISSUER)
      .setExpirationTime(overrides.expiresIn ?? '1h')
      .sign(privateKey);
  }

  function validIdTokenClaims(overrides: Record<string, unknown> = {}) {
    return {
      token_use: 'id',
      aud: CLIENT_ID,
      sub: 'cognito-sub-123',
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
      ...overrides,
    };
  }

  it('provisions/returns the account for a valid ID token', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims());
    const result = await verifier(token);

    expect(result).toEqual({ accountId: 'account-1', isPlatformAdmin: false });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO accounts'),
      ['cognito-sub-123', 'user@example.com', 'Test User'],
    );
  });

  it('falls back to the email local part for display_name when "name" is absent, never the raw cognito:username sub', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    // Email-alias user pools set `cognito:username` to the raw `sub` GUID when no `name`
    // attribute was collected at sign-up (e.g. via the hosted UI); it must never be used.
    const token = await signToken(validIdTokenClaims({ name: undefined, 'cognito:username': 'cognito-sub-123' }));
    await verifier(token);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO accounts'),
      ['cognito-sub-123', 'user@example.com', 'user'],
    );
  });

  it('returns null for an expired token', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims(), { expiresIn: '-1h' });
    expect(await verifier(token)).toBeNull();
  });

  it('returns null when a signed token has no expiration claim', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await new SignJWT(validIdTokenClaims())
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .sign(privateKey);

    expect(await verifier(token)).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns null for the wrong issuer', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims(), {
      issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_otherPool',
    });
    expect(await verifier(token)).toBeNull();
  });

  it('returns null for the wrong audience/client id', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims({ aud: 'some-other-client' }));
    expect(await verifier(token)).toBeNull();
  });

  it('returns null when token_use is not "id" (e.g. an access token)', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims({ token_use: 'access' }));
    expect(await verifier(token)).toBeNull();
  });

  it('returns null when sub is missing', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims({ sub: undefined }));
    expect(await verifier(token)).toBeNull();
  });

  it('returns null when email is missing', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims({ email: undefined }));
    expect(await verifier(token)).toBeNull();
  });

  it('returns null when the Cognito email is not verified', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await signToken(validIdTokenClaims({ email_verified: false }));
    expect(await verifier(token)).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a token signed by an unrelated key (bad signature)', async () => {
    const pool = fakePool([{ id: 'account-1', is_platform_admin: false }]);
    const { privateKey: otherKey } = await generateKeyPair('RS256', { extractable: true });
    const verifier = createCognitoVerifier(pool as never, {
      region: REGION,
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      getKey,
    });

    const token = await new SignJWT(validIdTokenClaims())
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setExpirationTime('1h')
      .sign(otherKey);

    expect(await verifier(token)).toBeNull();
  });
});
