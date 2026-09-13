import type { Pool } from 'pg';

import type { AuthVerifier } from './types.js';

// Development/test-only account resolution: treats the bearer token as an
// accounts.cognito_id. Production never selects this verifier; it requires the
// Cognito JWKS-backed ID-token verifier in createDefaultAuthVerifier.
export function createAccountLookupVerifier(pool: Pool): AuthVerifier {
  return async (token) => {
    const result = await pool.query<{ id: string; is_platform_admin: boolean }>(
      'SELECT id, is_platform_admin FROM accounts WHERE cognito_id = $1',
      [token],
    );

    if (result.rows.length === 0) return null;
    return { accountId: result.rows[0].id, isPlatformAdmin: result.rows[0].is_platform_admin };
  };
}
