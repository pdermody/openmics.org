import type { Pool } from 'pg';

import type { ProfileRow } from '../profiles/repository.js';

export type AccountRow = {
  id: string;
  cognito_id: string;
  email: string;
  display_name: string | null;
  city: string | null;
  preferred_language: string | null;
  current_profile_id: string | null;
  is_platform_admin: boolean;
  plan: string;
  created_at: Date;
  updated_at: Date;
};

export async function findAccountById(pool: Pool, id: string): Promise<AccountRow | null> {
  const result = await pool.query<AccountRow>(
    'SELECT id, cognito_id, email, display_name, city, preferred_language, current_profile_id, is_platform_admin, plan, created_at, updated_at FROM accounts WHERE id = $1',
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

export function serializeAccount(row: AccountRow) {
  return {
    id: row.id,
    cognito_id: row.cognito_id,
    email: row.email,
    display_name: row.display_name,
    city: row.city,
    preferred_language: row.preferred_language,
    current_profile_id: row.current_profile_id,
    is_platform_admin: row.is_platform_admin,
    plan: row.plan,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
