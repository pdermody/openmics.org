import type { Pool } from 'pg';

import { findOpenMicById, serializeOpenMic } from '../open-mics/repository.js';
import { findProfileById, serializeProfile } from '../profiles/repository.js';

export type HandleResolution = {
  handle: string;
  entity_type: 'profile' | 'open_mic' | null;
  profile_id: string | null;
  open_mic_id: string | null;
  status: string;
  redirects_to_handle: string | null;
  redirect_expires_at: Date | null;
};

export type PublicResolvedEntity = {
  type: 'profile' | 'open_mic';
  entity: ReturnType<typeof serializeProfile> | ReturnType<typeof serializeOpenMic>;
};

export async function findHandleResolution(pool: Pool, candidate: string): Promise<HandleResolution | null> {
  const result = await pool.query<HandleResolution>(
    `SELECT handle, entity_type, profile_id, open_mic_id, status, redirects_to_handle, redirect_expires_at
     FROM handles WHERE lower(handle) = lower($1)`,
    [candidate],
  );
  return result.rows[0] ?? null;
}

export async function findPublicEntity(pool: Pool, resolution: HandleResolution): Promise<PublicResolvedEntity | null> {
  if (resolution.entity_type === 'profile' && resolution.profile_id) {
    const profile = await findProfileById(pool, resolution.profile_id);
    if (!profile) return null;
    const flags = await pool.query<{ is_hidden: boolean; is_blacklisted: boolean }>(
      'SELECT is_hidden, is_blacklisted FROM profiles WHERE id = $1 AND deleted_at IS NULL',
      [resolution.profile_id],
    );
    if (!flags.rows[0] || flags.rows[0].is_hidden || flags.rows[0].is_blacklisted || profile.visibility === 'private') {
      return null;
    }
    return { type: 'profile', entity: serializeProfile(profile) };
  }

  if (resolution.entity_type === 'open_mic' && resolution.open_mic_id) {
    const openMic = await findOpenMicById(pool, resolution.open_mic_id);
    if (!openMic) return null;
    return { type: 'open_mic', entity: serializeOpenMic(openMic) };
  }

  return null;
}
