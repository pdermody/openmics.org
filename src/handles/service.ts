import type { PoolClient } from 'pg';

import { HandleConflictError, ValidationError } from '../errors.js';
import { slugifyDisplayName } from './slugify.js';
import { isValidHandleFormat } from './validation.js';

const UNIQUE_VIOLATION = '23505';
const COLLISION_SUFFIXES = [2, 3, 4, 5, 6, 7, 8, 9];

export type HandleEntityRef =
  | { entityType: 'profile'; profileId: string }
  | { entityType: 'open_mic'; openMicId: string };

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

async function tryInsertCurrentHandle(client: PoolClient, entity: HandleEntityRef, handle: string): Promise<boolean> {
  // A failed INSERT poisons the enclosing transaction until rolled back; use a
  // savepoint so a collision can be retried without aborting the whole request.
  await client.query('SAVEPOINT handle_insert_attempt');
  try {
    await client.query(
      `INSERT INTO handles (handle, entity_type, profile_id, open_mic_id, status)
       VALUES ($1, $2, $3, $4, 'current')`,
      [
        handle,
        entity.entityType,
        entity.entityType === 'profile' ? entity.profileId : null,
        entity.entityType === 'open_mic' ? entity.openMicId : null,
      ],
    );
    await client.query('RELEASE SAVEPOINT handle_insert_attempt');
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) {
      await client.query('ROLLBACK TO SAVEPOINT handle_insert_attempt');
      return false;
    }
    throw err;
  }
}

async function findCurrentHolder(
  client: PoolClient,
  handle: string,
): Promise<{ entityType: 'profile' | 'open_mic'; entityId: string } | null> {
  const result = await client.query<{ entity_type: 'profile' | 'open_mic'; profile_id: string | null; open_mic_id: string | null }>(
    "SELECT entity_type, profile_id, open_mic_id FROM handles WHERE lower(handle) = lower($1) AND status = 'current'",
    [handle],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { entityType: row.entity_type, entityId: (row.profile_id ?? row.open_mic_id)! };
}

// Assigns a current handle to a newly created entity within an existing transaction.
// An explicit requestedHandle that collides throws HandleConflictError (409);
// an omitted handle is auto-generated with a bounded collision-retry loop.
export async function assignHandle(
  client: PoolClient,
  entity: HandleEntityRef,
  options: { displayName: string; requestedHandle?: string },
): Promise<string> {
  if (options.requestedHandle) {
    if (!isValidHandleFormat(options.requestedHandle)) {
      throw new ValidationError('Handle does not meet the required format', { field: 'handle' });
    }

    const inserted = await tryInsertCurrentHandle(client, entity, options.requestedHandle);
    if (inserted) return options.requestedHandle;

    const holder = await findCurrentHolder(client, options.requestedHandle);
    throw new HandleConflictError(holder?.entityType ?? null, holder?.entityId ?? null);
  }

  const base = slugifyDisplayName(options.displayName);
  const candidates = [
    base,
    ...COLLISION_SUFFIXES.map((n) => `${base}-${n}`.slice(0, 50)),
    `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50),
  ];

  for (const candidate of candidates) {
    if (await tryInsertCurrentHandle(client, entity, candidate)) return candidate;
  }

  throw new Error('Unable to allocate a handle after all attempts');
}
