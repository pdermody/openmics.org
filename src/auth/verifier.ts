import type { Pool } from 'pg';

import type { AuthVerifier } from './types.js';

// Interim account resolution: treats the bearer token as an accounts.cognito_id.
// A real Cognito verifier would validate the JWT against Cognito's JWKS and
// extract the `sub` claim before this same lookup step; JWT signature
// verification is not yet implemented and must be added before production use.
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
