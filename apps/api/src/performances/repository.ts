import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type PerformanceRow = {
  id: string;
  registration_id: string;
  name: string;
  activity: string | null;
  sequence: number;
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by_profile_id: string | null;
  recovery_deadline: Date | null;
};

export async function insertPerformance(
  client: Queryable,
  input: { registrationId: string; name: string; activity?: string; sequence?: number; status?: string; notes?: string | null },
): Promise<PerformanceRow> {
  const result = await client.query<PerformanceRow>(
    `INSERT INTO performances (registration_id, name, activity, sequence, status, notes)
     VALUES ($1, $2, $3, COALESCE($4, 1), COALESCE($5, 'registered'), $6)
     RETURNING *`,
    [input.registrationId, input.name, input.activity ?? null, input.sequence ?? null, input.status ?? null, input.notes ?? null],
  );
  return result.rows[0];
}

export async function findPerformanceById(pool: Queryable, id: string): Promise<PerformanceRow | null> {
  const result = await pool.query<PerformanceRow>(
    'SELECT * FROM performances WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findPerformancesByRegistrationId(pool: Queryable, registrationId: string): Promise<PerformanceRow[]> {
  const result = await pool.query<PerformanceRow>(
    'SELECT * FROM performances WHERE registration_id = $1 AND deleted_at IS NULL ORDER BY sequence ASC, created_at ASC',
    [registrationId],
  );
  return result.rows;
}

// Batch lookup for the organizer roster page, so listing an event's registrations doesn't
// require one performances query per registration.
export async function findPerformancesByRegistrationIds(pool: Queryable, registrationIds: string[]): Promise<PerformanceRow[]> {
  if (registrationIds.length === 0) return [];
  const result = await pool.query<PerformanceRow>(
    'SELECT * FROM performances WHERE registration_id = ANY($1) AND deleted_at IS NULL ORDER BY sequence ASC, created_at ASC',
    [registrationIds],
  );
  return result.rows;
}

export async function updatePerformance(
  pool: Pool,
  id: string,
  changes: Partial<Record<'name' | 'activity' | 'sequence' | 'status' | 'notes', unknown>>,
): Promise<PerformanceRow | null> {
  const columns = ['name', 'activity', 'sequence', 'status', 'notes'] as const;
  const clauses: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  for (const column of columns) {
    if (changes[column] === undefined) continue;
    clauses.push(`${column} = $${index++}`);
    values.push(changes[column]);
  }
  if (clauses.length === 0) return findPerformanceById(pool, id);
  clauses.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<PerformanceRow>(
    `UPDATE performances SET ${clauses.join(', ')} WHERE id = $${index} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function softDeletePerformance(pool: Pool, id: string, deletedByProfileId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE performances
     SET deleted_at = now(), deleted_by_profile_id = $1, recovery_deadline = now() + interval '30 days', updated_at = now()
     WHERE id = $2 AND deleted_at IS NULL`,
    [deletedByProfileId, id],
  );
  return result.rowCount === 1;
}

export function serializePerformance(row: PerformanceRow, includeNotes = false) {
  return {
    id: row.id,
    registration_id: row.registration_id,
    name: row.name,
    activity: row.activity,
    sequence: row.sequence,
    status: row.status,
    ...(includeNotes ? { notes: row.notes } : {}),
  };
}
