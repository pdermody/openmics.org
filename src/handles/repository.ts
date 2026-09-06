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
