import type { Pool, PoolClient } from 'pg';

export type ProfileRow = {
  id: string;
  created_by_account_id: string;
  current_handle: string | null;
  profile_name: string;
  profile_kind: string;
  bio: string | null;
  phone: string | null;
  profile_image_url: string | null;
  theme_name: string | null;
  color_mode: string | null;
  visibility: string;
  show_gig_media: boolean;
  is_hidden: boolean;
  is_blacklisted: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  recovery_deadline: Date | null;
};

type Queryable = Pool | PoolClient;

export async function insertProfile(
  client: PoolClient,
  input: {
    createdByAccountId: string;
    profileName: string;
    profileKind: string;
    bio?: string;
    phone?: string | null;
    profileImageUrl?: string | null;
    visibility?: string;
    showGigMedia?: boolean;
    themeName?: string;
    colorMode?: string;
  },
): Promise<ProfileRow> {
  const result = await client.query<ProfileRow>(
    `INSERT INTO profiles (created_by_account_id, profile_name, profile_kind, bio, phone, profile_image_url, visibility, show_gig_media, theme_name, color_mode)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'public'), COALESCE($8, true), $9, $10)
     RETURNING *`,
    [
      input.createdByAccountId,
      input.profileName,
      input.profileKind,
      input.bio ?? null,
      input.phone ?? null,
      input.profileImageUrl ?? null,
      input.visibility ?? null,
      input.showGigMedia ?? null,
      input.themeName ?? null,
      input.colorMode ?? null,
    ],
  );
  return result.rows[0];
}

export async function findProfileById(client: Queryable, id: string): Promise<ProfileRow | null> {
  const result = await client.query<ProfileRow>('SELECT * FROM profiles WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] ?? null;
}

export async function findPublicProfiles(client: Queryable, limit: number, offset: number): Promise<{ rows: ProfileRow[]; total: number }> {
  const result = await client.query<ProfileRow>(
    `SELECT * FROM profiles
     WHERE deleted_at IS NULL AND visibility <> 'private' AND is_hidden = false AND is_blacklisted = false
     ORDER BY profile_name ASC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const count = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM profiles
     WHERE deleted_at IS NULL AND visibility <> 'private' AND is_hidden = false AND is_blacklisted = false`,
  );
  return { rows: result.rows, total: Number(count.rows[0].count) };
}

const UPDATABLE_COLUMNS = ['profile_name', 'bio', 'phone', 'profile_image_url', 'visibility', 'show_gig_media', 'theme_name', 'color_mode'] as const;

export async function updateProfile(
  pool: Pool,
  id: string,
  changes: Partial<Record<(typeof UPDATABLE_COLUMNS)[number], unknown>>,
): Promise<ProfileRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const column of UPDATABLE_COLUMNS) {
    if (changes[column] === undefined) continue;
    setClauses.push(`${column} = $${paramIndex++}`);
    values.push(changes[column]);
  }

  if (setClauses.length === 0) return findProfileById(pool, id);

  setClauses.push('updated_at = now()');
  values.push(id);

  const result = await pool.query<ProfileRow>(
    `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function countActiveProfiles(client: Queryable, accountId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM profiles WHERE created_by_account_id = $1 AND deleted_at IS NULL',
    [accountId],
  );
  return Number(result.rows[0].count);
}

export async function softDeleteProfile(client: Queryable, id: string): Promise<ProfileRow | null> {
  const result = await client.query<ProfileRow>(
    `UPDATE profiles
     SET deleted_at = now(), recovery_deadline = now() + interval '30 days', updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  const profile = result.rows[0] ?? null;
  if (profile) {
    await client.query('UPDATE accounts SET current_profile_id = NULL, updated_at = now() WHERE current_profile_id = $1', [id]);
  }
  return profile;
}

export function serializeProfile(row: ProfileRow, includePrivate = false) {
  return {
    id: row.id,
    created_by_account_id: row.created_by_account_id,
    current_handle: row.current_handle,
    profile_name: row.profile_name,
    profile_kind: row.profile_kind,
    bio: row.bio,
    ...(includePrivate ? { phone: row.phone } : {}),
    profile_image_url: row.profile_image_url,
    theme_name: row.theme_name,
    color_mode: row.color_mode,
    visibility: row.visibility,
    show_gig_media: row.show_gig_media,
    links: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    recovery_deadline: row.recovery_deadline,
  };
}
