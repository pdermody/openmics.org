import type { Pool } from 'pg';

import type { ProfileRow } from '../profiles/repository.js';

export type AccountRow = {
  id: string;
  cognito_id: string;
  email: string;
  display_name: string | null;
  city: string | null;
  city_id: string | null;
  city_location: {
    id: string; city: string; city_ascii: string; country: string; country_ascii: string;
    iso2: string; iso3: string | null; admin_name: string | null; lat: number; lng: number; population: number | null;
  } | null;
  preferred_language: string | null;
  current_profile_id: string | null;
  is_platform_admin: boolean;
  plan: string;
  created_at: Date;
  updated_at: Date;
};

export async function findAccountById(pool: Pool, id: string): Promise<AccountRow | null> {
  const result = await pool.query<AccountRow>(
    `SELECT a.id, a.cognito_id, a.email, a.display_name, a.city, a.city_id, a.preferred_language,
            a.current_profile_id, a.is_platform_admin, a.plan, a.created_at, a.updated_at,
            CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
              'id', c.id, 'city', c.city, 'city_ascii', c.city_ascii, 'country', c.country,
              'country_ascii', c.country_ascii, 'iso2', c.iso2, 'iso3', c.iso3, 'admin_name', c.admin_name,
              'lat', c.lat, 'lng', c.lng, 'population', c.population
            ) END AS city_location
     FROM accounts a
     LEFT JOIN LATERAL (
       SELECT cities.* FROM cities
       WHERE (a.city_id IS NOT NULL AND cities.id = a.city_id)
          OR (a.city_id IS NULL AND a.city IS NOT NULL
            AND (lower(cities.city) = lower(a.city) OR lower(cities.city_ascii) = lower(a.city))
            AND (SELECT count(*) FROM cities matched
                 WHERE lower(matched.city) = lower(a.city) OR lower(matched.city_ascii) = lower(a.city)) = 1)
       LIMIT 1
     ) c ON true
     WHERE a.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findAccountProfiles(pool: Pool, accountId: string): Promise<ProfileRow[]> {
  const result = await pool.query<ProfileRow>(
    'SELECT * FROM profiles WHERE created_by_account_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [accountId],
  );
  return result.rows;
}

/**
 * Finds the account for a verified Cognito identity, provisioning one on first sign-in.
 * Idempotent under concurrent first-time requests: `ON CONFLICT (cognito_id) DO UPDATE` is a
 * no-op write that still lets `RETURNING` produce the pre-existing row, so two simultaneous
 * requests for a brand-new identity can never create two account rows or throw on each other.
 */
export async function findOrCreateAccountByCognitoId(
  pool: Pool,
  input: { cognitoId: string; email: string; displayName: string | null },
): Promise<{ id: string; is_platform_admin: boolean }> {
  const result = await pool.query<{ id: string; is_platform_admin: boolean }>(
    `INSERT INTO accounts (cognito_id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (cognito_id) DO UPDATE SET updated_at = accounts.updated_at
     RETURNING id, is_platform_admin`,
    [input.cognitoId, input.email, input.displayName],
  );
  return result.rows[0];
}

export async function setCurrentProfile(pool: Pool, accountId: string, profileId: string): Promise<ProfileRow | null> {
  const result = await pool.query<ProfileRow>(
    `UPDATE profiles p SET updated_at = p.updated_at
     WHERE p.id = $1 AND p.created_by_account_id = $2 AND p.deleted_at IS NULL
     RETURNING p.*`,
    [profileId, accountId],
  );
  if (!result.rows[0]) return null;
  await pool.query('UPDATE accounts SET current_profile_id = $1, updated_at = now() WHERE id = $2', [profileId, accountId]);
  return result.rows[0];
}

const UPDATABLE_ACCOUNT_COLUMNS = ['display_name', 'city', 'city_id', 'preferred_language'] as const;

export async function updateAccount(
  pool: Pool,
  id: string,
  changes: Partial<Record<(typeof UPDATABLE_ACCOUNT_COLUMNS)[number], unknown>>,
): Promise<AccountRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const column of UPDATABLE_ACCOUNT_COLUMNS) {
    if (changes[column] === undefined) continue;
    setClauses.push(`${column} = $${paramIndex++}`);
    values.push(changes[column]);
  }

  if (setClauses.length === 0) return findAccountById(pool, id);

  setClauses.push('updated_at = now()');
  values.push(id);

  const result = await pool.query<AccountRow>(
    `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  if (!result.rows[0]) return null;
  return findAccountById(pool, id);
}

export function serializeAccount(row: AccountRow) {
  return {
    id: row.id,
    cognito_id: row.cognito_id,
    email: row.email,
    display_name: row.display_name,
    city: row.city,
    city_id: row.city_id,
    city_location: row.city_location,
    preferred_language: row.preferred_language,
    current_profile_id: row.current_profile_id,
    is_platform_admin: row.is_platform_admin,
    plan: row.plan,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
