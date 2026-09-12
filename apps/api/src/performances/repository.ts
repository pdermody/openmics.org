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
  checked_in_at: Date | null;
  scheduled_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by_profile_id: string | null;
  recovery_deadline: Date | null;
};

// Each lifecycle status has a corresponding "entered this state at" timestamp column, which is
// always set to the server's own clock (never a client-supplied value) whenever the row's status
// is set to that value, whether on creation or via a later update.
const STATUS_TIMESTAMP_COLUMNS: Partial<Record<string, string>> = {
  present: 'checked_in_at',
  scheduled: 'scheduled_at',
  performing: 'started_at',
  performed: 'finished_at',
};

// The two columns that carry a manually-orderable running order (see nextSequenceForColumn):
// Present is filled in check-in order (kiosk sign-ups included), Scheduled is the play queue.
// Performing/Performed don't need a column-scoped sequence — Performing is (at most) a single
// occupant, and Performed's order is fully implied by `finished_at`.
const SEQUENCED_COLUMNS = new Set(['present', 'scheduled']);

export async function insertPerformance(
  client: Queryable,
  input: { registrationId: string; eventId?: string; name: string; activity?: string; sequence?: number; status?: string; notes?: string | null },
): Promise<PerformanceRow> {
  const status = input.status ?? 'registered';
  const timestampColumn = STATUS_TIMESTAMP_COLUMNS[status];
  // Kiosk sign-ups are created directly in "present" — give them a bottom-of-column sequence
  // (same as any other card moved into Present) instead of defaulting to 1, so kiosk arrivals
  // queue up after whoever's already present rather than jumping to the front.
  let sequence = input.sequence;
  if (sequence === undefined && input.eventId && SEQUENCED_COLUMNS.has(status)) {
    sequence = await nextSequenceForColumn(client, input.eventId, status);
  }
  const result = await client.query<PerformanceRow>(
    `INSERT INTO performances (registration_id, name, activity, sequence, status, notes${timestampColumn ? `, ${timestampColumn}` : ''})
     VALUES ($1, $2, $3, COALESCE($4, 1), $5, $6${timestampColumn ? ', now()' : ''})
     RETURNING *`,
    [input.registrationId, input.name, input.activity ?? null, sequence ?? null, status, input.notes ?? null],
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

// Computes the next bottom-of-column running-order number for one status within an event, so
// whichever organizer/device first moves a performer into "present" or "scheduled" reserves the
// next slot at the bottom of that column. Present and Scheduled each have their own independent
// counter (a card moved into Present starts a fresh number there; moving it on into Scheduled
// starts again from Scheduled's own bottom) rather than one running counter shared across the
// whole event. Two organizers acting on the exact same instant could theoretically read the same
// MAX before either write lands — an accepted, low-likelihood race for this ordinal counter,
// consistent with how other roster actions in this codebase favor simplicity over full
// serializability.
export async function nextSequenceForColumn(pool: Queryable, eventId: string, status: string): Promise<number> {
  const result = await pool.query<{ next: string }>(
    `SELECT COALESCE(MAX(p.sequence), 0) + 1 AS next
     FROM performances p
     JOIN registrations r ON r.id = p.registration_id
     WHERE r.event_id = $1 AND p.status = $2 AND p.deleted_at IS NULL AND r.deleted_at IS NULL`,
    [eventId, status],
  );
  return Number(result.rows[0]?.next ?? 1);
}

// The Scheduled card eligible to move into Performing: the one with the lowest `sequence` (i.e.
// next up). Only that card may become "performing" via the ordinary forward transition.
export async function topOfScheduled(pool: Queryable, eventId: string): Promise<PerformanceRow | null> {
  const result = await pool.query<PerformanceRow>(
    `SELECT p.* FROM performances p
     JOIN registrations r ON r.id = p.registration_id
     WHERE r.event_id = $1 AND p.status = 'scheduled' AND p.deleted_at IS NULL AND r.deleted_at IS NULL
     ORDER BY p.sequence ASC, p.created_at ASC
     LIMIT 1`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

// The Performed card eligible to move back out of that column: the most recently finished one
// (Performed has no sequence of its own — order is implied entirely by `finished_at`). Only that
// card may be moved elsewhere, covering the "moved to performed too early by mistake" fix-up case.
export async function lastPerformed(pool: Queryable, eventId: string): Promise<PerformanceRow | null> {
  const result = await pool.query<PerformanceRow>(
    `SELECT p.* FROM performances p
     JOIN registrations r ON r.id = p.registration_id
     WHERE r.event_id = $1 AND p.status = 'performed' AND p.deleted_at IS NULL AND r.deleted_at IS NULL
     ORDER BY p.finished_at DESC NULLS LAST, p.created_at DESC
     LIMIT 1`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

// Count of this registration's other non-deleted performances, used to decide whether deleting a
// performance should cascade into deleting the whole registration (see softDeletePerformance's
// caller in performances/routes.ts).
export async function countOtherPerformancesForRegistration(pool: Queryable, registrationId: string, excludingPerformanceId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM performances WHERE registration_id = $1 AND id <> $2 AND deleted_at IS NULL',
    [registrationId, excludingPerformanceId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function updatePerformance(
  pool: Pool,
  id: string,
  changes: Partial<Record<'name' | 'activity' | 'sequence' | 'status' | 'notes', unknown>>,
  previousStatus?: string,
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
  const newStatus = typeof changes.status === 'string' ? changes.status : undefined;
  // Re-entering "performing" straight from "performed" is the fix-up path for a card moved to
  // Performed too early by mistake — the performer never actually stopped, so the original
  // `started_at` is preserved instead of being overwritten with a fresh timestamp, and the
  // now-incorrect `finished_at` is cleared since they haven't finished after all.
  const isResumingFromPerformed = previousStatus === 'performed' && newStatus === 'performing';
  // Moving back from "performing" to "scheduled" undoes both timestamps stamped so far (they
  // were never actually finished, and are no longer "on stage" either), so the card starts the
  // performing stage fresh next time it's brought forward again.
  const isReturningToScheduled = previousStatus === 'performing' && newStatus === 'scheduled';
  if (isResumingFromPerformed) {
    clauses.push('finished_at = NULL');
  } else if (isReturningToScheduled) {
    clauses.push('started_at = NULL', 'finished_at = NULL');
  } else {
    const timestampColumn = newStatus ? STATUS_TIMESTAMP_COLUMNS[newStatus] : undefined;
    if (timestampColumn) clauses.push(`${timestampColumn} = now()`);
  }
  clauses.push('updated_at = now()');
  values.push(id);
  const result = await pool.query<PerformanceRow>(
    `UPDATE performances SET ${clauses.join(', ')} WHERE id = $${index} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

// Called when an organizer stops an event (Events.running -> false): anyone who never checked in
// is treated as a no-show automatically, since the event is over and they didn't show up. Only
// 'registered' rows are affected — performers already present/scheduled/performing/performed (or
// already no_show/cancelled) are left untouched. Returns the affected performance rows so callers
// can publish roster notifications for them.
export async function markUnregisteredAsNoShowForEvent(pool: Queryable, eventId: string): Promise<PerformanceRow[]> {
  const result = await pool.query<PerformanceRow>(
    `UPDATE performances p
     SET status = 'no_show', updated_at = now()
     FROM registrations r
     WHERE p.registration_id = r.id AND r.event_id = $1 AND p.status = 'registered' AND p.deleted_at IS NULL
     RETURNING p.*`,
    [eventId],
  );
  return result.rows;
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

// Called (after markUnregisteredAsNoShowForEvent) when an organizer stops an event: a valid,
// reportable performance requires both a start and finish time (i.e. the performer actually got
// on stage), so any row that never reached "performing" — still registered/present/scheduled, or
// bulk-marked no_show/cancelled — is cleared out once the night is over rather than left cluttering
// history and reports with sets that never happened.
export async function deleteNeverStartedPerformancesForEvent(pool: Queryable, eventId: string, deletedByProfileId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE performances p
     SET deleted_at = now(), deleted_by_profile_id = $1, recovery_deadline = now() + interval '30 days', updated_at = now()
     FROM registrations r
     WHERE p.registration_id = r.id AND r.event_id = $2 AND p.started_at IS NULL AND p.deleted_at IS NULL`,
    [deletedByProfileId, eventId],
  );
  return result.rowCount ?? 0;
}

export function serializePerformance(row: PerformanceRow, includeNotes = false) {
  return {
    id: row.id,
    registration_id: row.registration_id,
    name: row.name,
    activity: row.activity,
    sequence: row.sequence,
    status: row.status,
    checked_in_at: row.checked_in_at?.toISOString() ?? null,
    scheduled_at: row.scheduled_at?.toISOString() ?? null,
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    ...(includeNotes ? { notes: row.notes } : {}),
  };
}
