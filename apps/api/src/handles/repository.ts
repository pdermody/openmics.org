import type { Pool } from 'pg';

export type HandleAvailabilityReason =
  | 'reserved'
  | 'in_use'
  | 'invalid_format'
  | 'redirect'
  | 'quarantined'
  | 'tombstoned';

export type HandleAvailability = {
  available: boolean;
  reason?: HandleAvailabilityReason;
};

const STATUS_TO_REASON: Record<string, HandleAvailabilityReason | null> = {
  current: 'in_use',
  redirect: 'redirect',
  quarantined: 'quarantined',
  reserved: 'reserved',
  tombstoned: 'tombstoned',
  available: null,
};

export async function checkHandleAvailability(pool: Pool, candidate: string): Promise<HandleAvailability> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM handles WHERE lower(handle) = lower($1)',
    [candidate],
  );

  if (result.rows.length === 0) return { available: true };

  const reason = STATUS_TO_REASON[result.rows[0].status];
  return reason ? { available: false, reason } : { available: true };
}

export type HandleResolution = {
  entityType: 'profile' | 'open_mic';
  profileId: string | null;
  openMicId: string | null;
};

// The `handles` table is the single source of truth for handle -> entity resolution (per
// docs/6-open-mic-vanity-urls.md §3/§10) — callers resolving a public /@handle URL should use
// this instead of matching an entity table's denormalized current_handle column directly.
export async function resolveCurrentHandle(pool: Pool, handle: string): Promise<HandleResolution | null> {
  const result = await pool.query<{ entity_type: 'profile' | 'open_mic' | null; profile_id: string | null; open_mic_id: string | null }>(
    `SELECT entity_type, profile_id, open_mic_id FROM handles WHERE lower(handle) = lower($1)
     AND (status = 'current' OR (status = 'redirect' AND redirect_expires_at > now()))`,
    [handle],
  );
  const row = result.rows[0];
  if (!row || !row.entity_type) return null;
  return { entityType: row.entity_type, profileId: row.profile_id, openMicId: row.open_mic_id };
}
