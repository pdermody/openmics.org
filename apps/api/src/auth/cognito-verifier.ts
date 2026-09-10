import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Pool } from 'pg';

import { findOrCreateAccountByCognitoId } from '../accounts/repository.js';
import type { AuthVerifier } from './types.js';

export type CognitoVerifierOptions = {
  region: string;
  userPoolId: string;
  clientId: string;
  // Injectable for tests (a `jose.createLocalJWKSet` over an in-memory key), defaults to a
  // caching remote fetch against Cognito's real JWKS endpoint in production.
  getKey?: JWTVerifyGetKey;
};

/**
 * Verifies the Cognito ID token the SPA sends as `Authorization: Bearer` (see
 * docs/5-open-mic-frontend-architecture.md §"Auth & session" — the client attaches the ID
 * token, not the access token, because the API needs the verified `email` claim for guest
 * registration claiming). Rejects anything that isn't a validly signed, unexpired ID token
 * issued by this exact user pool for this exact app client.
 */
export function createCognitoVerifier(pool: Pool, options: CognitoVerifierOptions): AuthVerifier {
  const issuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    let payload;
    try {
      const verified = await jwtVerify(token, getKey, {
        issuer,
        algorithms: ['RS256'],
      });
      payload = verified.payload;
    } catch {
      // Covers malformed tokens, bad/rotated signatures, wrong issuer (wrong pool), and expiry.
      return null;
    }

    // Reject access tokens (and any other token_use) outright; only ID tokens carry the
    // verified email claim this app relies on, and only ID tokens are the documented contract.
    if (payload.token_use !== 'id') return null;

    // Cognito ID tokens carry the app client id in `aud`, not `client_id` (that's access tokens).
    if (payload.aud !== options.clientId) return null;

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.email !== 'string' || payload.email.length === 0) return null;

    // `cognito:username` is not a reliable display name: for user pools with email as the
    // sign-in alias (this one), Cognito sets it to the raw `sub` GUID unless the user set a
    // `name` attribute, which the hosted UI sign-up flow used here does not collect. Falling
    // back to it produced GUID display names/profile names. Prefer the email's local part
    // instead, which is always a human-readable string.
    const displayName =
      (typeof payload.name === 'string' && payload.name) ||
      payload.email.split('@')[0];

    const account = await findOrCreateAccountByCognitoId(pool, {
      cognitoId: payload.sub,
      email: payload.email,
      displayName,
    });

    return { accountId: account.id, isPlatformAdmin: account.is_platform_admin };
  };
}
